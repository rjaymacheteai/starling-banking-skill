import readline from 'node:readline/promises';
import { getOperation } from './catalogue.mjs';
import { GROUPS } from './config.mjs';
import { CliError } from './errors.mjs';
import { guardFor } from './guards.mjs';
import { requestHash } from './state.mjs';
import { bankApproval } from './bank-approval.mjs';
import { redact } from './redact.mjs';

const PREFIX = { payments: 'pay', payees: 'payee', 'account-settings': 'acct' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The single gate every API operation passes through: permission group check, then either
// run it (reads and low-risk writes) or turn it into a preview that needs a confirm.
export function assertGroup(ctx, group, what = 'that action') {
  if (ctx.config.permissions.includes(group)) return;
  const g = GROUPS[group];
  throw new CliError('PERMISSION_DISABLED', `"${group}" actions are switched off in your config, so ${what} was not run.`, {
    hint: `${g.title}: ${g.summary} To allow it, the user adds "${group}" to "permissions" in ${ctx.configFile} (see config.json.example). Tell the user this is switched off; do not edit the config yourself unless they explicitly ask you to.`,
    details: { group, enabled: ctx.config.permissions },
  });
}

export function assertAllowed(ctx, op) {
  assertGroup(ctx, op.group, op.operationId);
}

function genericSummary(op, request) {
  const target = op.path.replace(/\{(\w+)\}/g, (_, k) => request.pathParams[k] ?? `{${k}}`);
  const body = request.body === undefined ? '' : `\nRequest values:\n${JSON.stringify(request.body, null, 2)}`;
  const query = Object.keys(request.query ?? {}).length ? `\nQuery values: ${JSON.stringify(request.query)}` : '';
  return `${op.summary || op.operationId} (${op.method} ${target})${query}${body}`;
}

export async function runOperation(ctx, operationId, input = {}) {
  const op = getOperation(operationId);
  assertAllowed(ctx, op);
  const request = { pathParams: input.pathParams ?? {}, query: input.query ?? {}, body: input.body };

  if (!op.confirm) return { status: 'ok', ...(await execute(ctx, op, { ...request, rawBody: input.rawBody, contentType: input.contentType, out: input.out, force: input.force })) };

  const guard = guardFor(operationId);
  const checked = guard
    ? await guard(ctx, request)
    : {
        summary: input.summary ?? genericSummary(op, request),
        details: input.details ?? { operation: op.operationId, method: op.method, path: op.path, body: request.body },
        meta: { kind: 'write' },
      };
  if (op.signed) void ctx.client.signer; // fail now, not after the user has approved, if signing is not set up
  const plan = ctx.plans.create({
    prefix: PREFIX[op.group] ?? 'act',
    request: { operationId, ...request, environment: ctx.config.environment },
    summary: checked.summary,
    details: checked.details,
    meta: { ...checked.meta, group: op.group },
    expiresMinutes: ctx.config.confirmation.expiresMinutes,
  });
  const how = ctx.config.confirmation.mode === 'terminal'
    ? `The user must approve this in a terminal: node scripts/starling-banking.mjs confirm ${plan.code}`
    : `After the user explicitly approves exactly this action, run: node scripts/starling-banking.mjs confirm ${plan.code}`;
  return {
    status: 'needs_confirmation',
    summary: plan.summary,
    details: plan.details,
    confirmCode: plan.code,
    expiresAt: plan.expiresAt,
    nextStep: how,
    instructions: 'Nothing has happened yet. Show the user the summary and wait for a clear yes before confirming. If they want changes, cancel this code and prepare a new action.',
  };
}

async function execute(ctx, op, request, { planCode } = {}) {
  let res;
  try {
    res = await ctx.client.call(op, request);
  } catch (e) {
    if (op.method !== 'GET') {
      const unknown = e instanceof CliError && (e.details?.maybeReceived || e.code === 'SERVER_ERROR');
      ctx.ledger.append({ kind: op.group === 'payments' ? 'payment' : 'write', operationId: op.operationId, group: op.group, planCode, outcome: unknown ? 'unknown' : 'failed', error: e.code, ...paymentFields(op, request) });
    }
    throw e;
  }
  if (op.method !== 'GET') {
    ctx.ledger.append({ kind: op.group === 'payments' ? 'payment' : 'write', operationId: op.operationId, group: op.group, planCode, outcome: 'submitted', httpStatus: res.status, ...paymentFields(op, request) });
  }
  return { result: res.file ? { file: res.file, bytes: res.bytes } : (res.data ?? res.text ?? null), httpStatus: res.status, ...(res.note ? { note: res.note } : {}) };
}

function paymentFields(op, request) {
  if (op.group !== 'payments' || !request.body?.amount) return {};
  return {
    amountMinor: request.body.amount.minorUnits,
    currency: request.body.amount.currency,
    externalIdentifier: request.body.externalIdentifier,
    destinationPayeeAccountUid: request.body.destinationPayeeAccountUid,
  };
}

async function askInTerminal(ctx, plan) {
  if (!ctx.stdin.isTTY) {
    throw new CliError('TERMINAL_APPROVAL_REQUIRED', 'Your config requires a person to approve this in a terminal, and this is not an interactive terminal.', {
      hint: `Ask the user to run this themselves (in Claude Code they can type it after "! "): node scripts/starling-banking.mjs confirm ${plan.code}`,
    });
  }
  const rl = readline.createInterface({ input: ctx.stdin, output: process.stderr });
  const answer = await rl.question(`${redact(plan.summary)}\nType the code ${plan.code} to approve: `);
  rl.close();
  if (answer.trim().toUpperCase() !== plan.code.toUpperCase()) throw new CliError('NOT_APPROVED', 'The code did not match, so nothing was sent.');
}

export async function confirmPlan(ctx, code, { retry = false } = {}) {
  const plan = ctx.plans.load(code);
  if (plan.status === 'done') return { status: 'ok', alreadyExecuted: true, note: 'This request was already submitted; it was not repeated.', ...plan.outcome, ...bankApproval(plan.outcome?.result) };
  if (plan.status === 'failed') throw new CliError('PLAN_FAILED', `This action failed earlier (${plan.failure}). Nothing was sent.`, { hint: 'Prepare it again if the user still wants it.' });
  if (['executing', 'unknown'].includes(plan.status) && !retry) {
    throw new CliError('PLAN_UNCERTAIN', 'An earlier attempt at this action did not finish cleanly, so it may have gone through.', {
      hint: `Check the result first (for payments: \`payments status\` or \`transactions list --days 2\`). Only if it clearly did not happen, re-run: confirm ${plan.code} --retry`,
    });
  }
  if (Date.now() > Date.parse(plan.expiresAt) && plan.status === 'prepared') {
    ctx.plans.remove(plan.code);
    throw new CliError('PLAN_EXPIRED', 'This confirmation code has expired.', { hint: 'Prepare the action again to get a fresh code.' });
  }
  if (plan.requestHash !== requestHash(plan.request)) {
    ctx.plans.remove(plan.code);
    throw new CliError('PLAN_TAMPERED', 'The saved action no longer matches what was previewed, so it was discarded.');
  }
  if (plan.request.environment !== ctx.config.environment) {
    throw new CliError('ENVIRONMENT_CHANGED', `This action was prepared for ${plan.request.environment} but your config now says ${ctx.config.environment}.`);
  }

  const op = getOperation(plan.request.operationId);
  assertAllowed(ctx, op);
  const guard = guardFor(op.operationId);
  if (guard) await guard(ctx, plan.request, { excludePlan: plan.code }); // limits may have changed since the preview
  if (ctx.config.confirmation.mode === 'terminal') await askInTerminal(ctx, plan);

  plan.status = 'executing';
  plan.attempts = (plan.attempts ?? 0) + 1;
  ctx.plans.save(plan);
  const { operationId, environment, ...request } = plan.request;
  let outcome;
  try {
    outcome = await execute(ctx, op, request, { planCode: plan.code });
  } catch (e) {
    const unknown = e instanceof CliError && (e.details?.maybeReceived || e.code === 'SERVER_ERROR');
    plan.status = unknown ? 'unknown' : 'failed';
    plan.failure = e.code;
    ctx.plans.save(plan);
    if (unknown) e.hint = `${e.hint ?? ''} The request may have been received. Check before retrying; if it clearly did not happen, run: confirm ${plan.code} --retry`.trim();
    throw e;
  }

  const extra = op.operationId === 'makeLocalPayment' ? await paymentSnapshot(ctx, outcome.result) : {};
  const done = { summary: plan.summary, ...outcome, ...extra, ...bankApproval(outcome.result) };
  plan.status = 'done';
  plan.outcome = done;
  ctx.plans.save(plan);
  return { status: 'ok', ...done };
}

// Starling accepts a payment instruction first and settles it afterwards, so the response
// is "submitted", not "paid". A single early look at the payment order gives a first signal.
async function paymentSnapshot(ctx, result) {
  const uid = result?.paymentOrderUid;
  const base = {
    paymentOrderUid: uid,
    paymentState: 'submitted',
    reminder: 'Starling may hold the payment as PENDING for review, and may ask the user to approve it in the Starling app. Check with `payments status`.',
  };
  if (!uid) return base;
  try {
    if (ctx.retryDelayMs) await sleep(1500);
    const res = await ctx.client.call(getOperation('getPaymentOrderPayments'), { pathParams: { paymentOrderUid: uid } });
    return { ...base, earlyStatus: res.data?.payments ?? [] };
  } catch {
    return base;
  }
}

export function cancelPlan(ctx, code) {
  const plan = ctx.plans.load(code);
  if (plan.status !== 'prepared') {
    throw new CliError('PLAN_NOT_CANCELLABLE', `This action is ${plan.status}, so it cannot be cancelled.`, { hint: plan.status === 'unknown' ? 'It may have gone through. Check payments status.' : undefined });
  }
  ctx.plans.remove(code);
  return { status: 'ok', cancelled: code };
}
