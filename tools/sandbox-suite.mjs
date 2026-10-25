#!/usr/bin/env node
// Real sandbox API integration checks. No models, live hosts or live credentials.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { main } from '../scripts/lib/cli.mjs';
import { loadConfig } from '../scripts/lib/config.mjs';
import { assertSandboxConfig, assertSandboxToken } from './lib/sandbox-guard.mjs';
import { sandboxPaths } from './lib/sandbox-paths.mjs';

const { values } = parseArgs({ options: { phase: { type: 'string', default: 'all' }, profiles: { type: 'string', default: 'all' } } });
if (!['all', 'reads', 'writes', 'payments', 'notes'].includes(values.phase)) throw new Error('Phase must be reads, writes, payments, notes or all.');
const root = fileURLToPath(new URL('../', import.meta.url));
const profiles = ['individual', 'individual-2', 'joint', 'business'];
const selected = values.profiles === 'all' ? profiles : values.profiles.split(',');
if (!selected.length || selected.some((p) => !profiles.includes(p))) throw new Error('Unknown sandbox customer.');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const paymentReference = `SBS${Date.now().toString(36)}`;
const runDir = path.join(root, '.local/sandbox/runs', runId);
mkdirSync(runDir, { recursive: true, mode: 0o700 });
const report = { runId, environment: 'sandbox', phase: values.phase, cases: [], resources: {}, startedAt: new Date().toISOString() };
const save = () => writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const liveConfigFile = path.join(root, '.local', 'config.json');
const liveAuth = existsSync(liveConfigFile) ? JSON.parse(readFileSync(liveConfigFile, 'utf8')).auth ?? {} : {};
const liveTokens = [liveAuth.accountToken, liveAuth.paymentToken].filter(Boolean);
class Blocked extends Error {}
class Skipped extends Error {}
const contexts = new Map();
let lastCall = 0;

function context(profile) {
  const paths = sandboxPaths(root, profile);
  const env = { ...process.env, STARLING_BANKING_HOME: paths.home, STARLING_BANKING_CONFIG: paths.configFile, STARLING_BANKING_RETRY_DELAY_MS: '0' };
  delete env.STARLING_BANKING_TEST_BASE_URL;
  const resources = { payees: [], goals: [], notesToRestore: [], pendingApprovals: [] };
  report.resources[profile] = resources;
  const ctx = { profile, paths, env, resources };
  ctx.call = async (args) => {
    // Reload and guard each call, including cleanup. Runtime config/state never leave this sandbox customer.
    const base = loadConfig({ ...env, STARLING_BANKING_CONFIG: paths.configFile }).config;
    assertSandboxConfig(base, env, paths.configFile);
    assertSandboxToken(base.auth.accountToken ?? '', liveTokens);
    if (base.auth.paymentToken) assertSandboxToken(base.auth.paymentToken, liveTokens);
    await sleep(Math.max(0, 1100 - (Date.now() - lastCall)));
    lastCall = Date.now();
    const result = await main(args, env);
    const json = JSON.parse(result.stdout);
    if (result.exitCode !== 0 || json.status === 'error') {
      const e = new Error(json.error?.message ?? 'CLI failed');
      e.code = json.error?.code;
      throw e;
    }
    return json;
  };
  ctx.confirm = async (preview) => {
    assert.equal(preview.status, 'needs_confirmation');
    const result = await ctx.call(['confirm', preview.confirmCode]);
    if (result.data.actionState === 'awaiting_bank_approval') {
      resources.pendingApprovals.push({ code: preview.confirmCode, httpStatus: result.data.httpStatus, operation: preview.command, ...result.data.bankApproval });
      save();
      throw new Blocked('Sandbox returned IN_APP_APPROVAL; this operation is pending, not completed.');
    }
    return result.data;
  };
  return ctx;
}

async function check(ctx, name, fn) {
  let entry;
  try { entry = { customer: ctx.profile, name, status: 'pass', observed: await fn() }; }
  catch (e) {
    entry = { customer: ctx.profile, name, status: e instanceof Blocked || e.code === 'FORBIDDEN' ? 'blocked' : e instanceof Skipped ? 'skipped' : 'fail', errorCode: e.code, message: e.message.slice(0, 500) };
  }
  report.cases.push(entry); save();
  console.log(`${entry.status.toUpperCase()} ${ctx.profile}: ${name}${entry.message ? ` — ${entry.message}` : ''}`);
  return entry.status;
}

async function expectCode(ctx, args, expected) {
  try { await ctx.call(args); } catch (e) {
    assert.ok(expected.includes(e.code), `Expected ${expected.join('/')} but got ${e.code}: ${e.message}`);
    return { errorCode: e.code };
  }
  assert.fail(`Expected ${expected.join('/')} but the command succeeded.`);
}

async function reads(ctx) {
  await check(ctx, 'account holder type', async () => {
    const type = ctx.holder.holder.accountHolderType;
    assert.equal(type, ctx.profile.startsWith('individual') ? 'INDIVIDUAL' : ctx.profile.toUpperCase());
    return { type, accounts: ctx.accounts.length };
  });
  await check(ctx, 'balances and confirmation of funds', async () => {
    const b = (await ctx.call(['accounts', 'balance'])).data;
    assert.equal(typeof b.raw.effectiveBalance.minorUnits, 'number');
    const f = (await ctx.call(['accounts', 'can-afford', '0.01'])).data;
    assert.equal(typeof f.result.requestedAmountAvailableToSpend, 'boolean');
    return { currency: b.raw.effectiveBalance.currency, availableMinor: b.raw.effectiveBalance.minorUnits };
  });
  await check(ctx, 'transactions and totals', async () => {
    const r = (await ctx.call(['transactions', 'list', '--days', '30', '--limit', '5', '--summary'])).data;
    assert.ok(Array.isArray(r.transactions)); ctx.transactions = r.transactions;
    return { count: r.totals.count, shown: r.transactions.length };
  });
  for (const args of [['cards', 'list'], ['goals', 'list'], ['spaces', 'list'], ['mandates', 'list'], ['payments', 'standing-orders']]) {
    await check(ctx, args.join(' '), async () => { const r = await ctx.call(args); assert.ok(r.data !== null); return { received: true }; });
  }
  await check(ctx, 'CSV export with date-only parameters', async () => {
    const file = path.join(runDir, `${ctx.profile}.csv`);
    await ctx.call(['transactions', 'export', '--days', '7', '--out', file]);
    assert.ok(statSync(file).size > 0); assert.ok(readFileSync(file, 'utf8').split('\n')[0].includes(','));
    return { bytes: statSync(file).size };
  });
  await check(ctx, 'cross-customer account isolation', async () => {
    return expectCode(ctx, ['accounts', 'balance', '--account', ctx.target.account.accountUid], ['ACCOUNT_NOT_FOUND']);
  });
  await check(ctx, 'bank rejects another customer token', () => expectCode(ctx,
    ['call', 'getAccountBalance', '--param', `accountUid=${ctx.target.account.accountUid}`], ['FORBIDDEN', 'NOT_FOUND']));
}

async function savings(ctx) {
  let uid;
  try {
    await check(ctx, 'savings goal create and read back', async () => {
      const r = (await ctx.call(['goals', 'create', '--name', `SBS ${runId}`, '--target', '1'])).data;
      assert.ok(r.savingsGoalUid); uid = r.savingsGoalUid; ctx.resources.goals.push(uid); save();
      const goal = (await ctx.call(['goals', 'get', uid])).data;
      assert.equal(goal.name, `SBS ${runId}`); return { created: true };
    });
    await check(ctx, 'savings transfer in and out', async () => {
      if (!uid) throw new Skipped('Goal creation did not complete.');
      await ctx.call(['goals', 'add', uid, '--amount', '0.01']);
      assert.equal((await ctx.call(['goals', 'get', uid])).data.totalSaved.minorUnits, 1);
      await ctx.call(['goals', 'withdraw', uid, '--amount', '0.01']);
      assert.equal((await ctx.call(['goals', 'get', uid])).data.totalSaved.minorUnits, 0);
      return { roundTripMinor: 1 };
    });
    await check(ctx, 'savings rejects withdrawal from empty goal', async () => {
      if (!uid) throw new Skipped('No test goal.');
      return expectCode(ctx, ['goals', 'withdraw', uid, '--amount', '0.01'], ['BAD_REQUEST', 'API_REJECTED']);
    });
    await check(ctx, 'zero-value savings transfer rejected locally', async () => {
      if (!uid) throw new Skipped('No test goal.');
      return expectCode(ctx, ['goals', 'add', uid, '--amount', '0'], ['USAGE']);
    });
  } finally {
    if (uid) await check(ctx, 'savings goal cleanup', async () => {
      await ctx.call(['goals', 'delete', uid]);
      assert.ok(!(await ctx.call(['goals', 'list'])).data.goals.some((g) => g.savingsGoalUid === uid));
      ctx.resources.goals = ctx.resources.goals.filter((id) => id !== uid); return { removed: true };
    });
  }
}

async function cardsAndNotes(ctx) {
  await check(ctx, 'card lock/unlock and restore', async () => {
    const card = (await ctx.call(['cards', 'list'])).data.cards.find((c) => !c.cancelled);
    if (!card || typeof card.unlocked !== 'boolean') throw new Skipped('No usable card on this sandbox customer.');
    try {
      await ctx.call(['cards', card.unlocked ? 'lock' : 'unlock', card.cardUid]);
      assert.equal((await ctx.call(['cards', 'list'])).data.cards.find((c) => c.cardUid === card.cardUid).unlocked, !card.unlocked);
    } finally { await ctx.call(['cards', card.unlocked ? 'unlock' : 'lock', card.cardUid]); }
    assert.equal((await ctx.call(['cards', 'list'])).data.cards.find((c) => c.cardUid === card.cardUid).unlocked, card.unlocked);
    return { restored: true };
  });
  await notes(ctx);
}

async function notes(ctx) {
  await check(ctx, 'transaction note write/read and restore', async () => {
    const tx = (await ctx.call(['transactions', 'list', '--days', '30', '--limit', '1'])).data.transactions[0];
    if (!tx) throw new Skipped('No seeded transactions.');
    const original = (await ctx.call(['transactions', 'get', tx.feedItemUid])).data.userNote ?? '';
    const note = `SBS ${runId}`;
    ctx.resources.notesToRestore.push({ feedItemUid: tx.feedItemUid, original }); save();
    try {
      await ctx.call(['transactions', 'note', tx.feedItemUid, note]);
      assert.equal((await ctx.call(['transactions', 'get', tx.feedItemUid])).data.userNote, note);
    } finally {
      await ctx.call(['transactions', 'note', tx.feedItemUid, ...(original ? [original] : ['--clear'])]);
      assert.equal((await ctx.call(['transactions', 'get', tx.feedItemUid])).data.userNote ?? '', original);
      ctx.resources.notesToRestore = ctx.resources.notesToRestore.filter((item) => item.feedItemUid !== tx.feedItemUid);
    }
    return { restored: true };
  });
}

async function payeesAndPayments(ctx, writes, payments) {
  const label = `SBS ${runId} ${ctx.profile}`;
  const target = ctx.target;
  const bank = target.identifiers;
  const details = ['--sort-code', bank.bankIdentifier, '--account-number', bank.accountIdentifier];
  const type = target.holder.holder.accountHolderType === 'BUSINESS' ? 'business' : 'individual';
  let uid; let mutable = true;
  try {
    if (writes) await check(ctx, 'payee preview is non-mutating and cancellation works', async () => {
      const preview = await ctx.call(['payees', 'add', '--name', `${label} cancel`, '--type', type, ...details]);
      assert.equal(preview.status, 'needs_confirmation');
      assert.equal((await ctx.call(['payees', 'list', '--name', `${label} cancel`])).data.count, 0);
      await ctx.call(['cancel', preview.confirmCode]);
      await expectCode(ctx, ['confirm', preview.confirmCode], ['PLAN_NOT_FOUND']);
      return { cancelled: true };
    });
    await check(ctx, 'label-only payee create and idempotent confirmation', async () => {
      const preview = await ctx.call(['payees', 'add', '--name', label, '--type', type, ...details]);
      const result = await ctx.confirm(preview);
      uid = result.result?.payeeUid; assert.ok(uid); ctx.resources.payees.push(uid); save();
      const again = (await ctx.call(['confirm', preview.confirmCode])).data;
      assert.equal(again.alreadyExecuted, true);
      assert.equal((await ctx.call(['payees', 'list', '--name', label])).data.count, 1);
      return { created: true, duplicateSubmissionPrevented: true };
    });
    if (writes) {
      await check(ctx, 'payee read masks account number by default', async () => {
        if (!uid) throw new Skipped('No test payee.');
        const r = (await ctx.call(['payees', 'get', uid])).data;
        assert.ok(r.accounts.every((a) => a.accountNumber !== bank.accountIdentifier));
        assert.equal(r.firstName, null); assert.equal(r.lastName, null); assert.equal(r.businessName, null);
        return { masked: true, namePartsNotInferred: true };
      });
      const nameArgs = type === 'business' ? ['--business-name', 'Deliberately Wrong Sandbox Ltd'] : ['--first-name', 'DeliberatelyWrong', '--last-name', 'SandboxName'];
      await check(ctx, 'intentionally wrong recipient name update and read back', async () => {
        if (!uid) throw new Skipped('No test payee.');
        try {
          await ctx.confirm(await ctx.call(['payees', 'update', uid, ...nameArgs]));
          const r = (await ctx.call(['payees', 'get', uid, '--reveal'])).data;
          assert.equal(type === 'business' ? r.businessName : r.firstName, type === 'business' ? nameArgs[1] : 'DeliberatelyWrong');
          assert.ok(r.accounts.some((a) => a.accountNumber === bank.accountIdentifier));
          assert.equal(r.bankNameCheck, 'not_reported_by_api');
          return { wrongNameStored: true, bankMatchNotEstablished: true, accountsPreserved: true };
        } catch (e) { if (e instanceof Blocked) mutable = false; throw e; }
      });
      await check(ctx, 'display rename preserves supplied name and accounts', async () => {
        if (!uid || !mutable) throw new Skipped('Payee unavailable or awaiting bank approval.');
        const before = (await ctx.call(['payees', 'get', uid, '--reveal'])).data;
        await ctx.confirm(await ctx.call(['payees', 'rename', uid, '--name', `${label} renamed`]));
        const after = (await ctx.call(['payees', 'get', uid, '--reveal'])).data;
        assert.equal(after.payeeName, `${label} renamed`);
        for (const k of ['firstName', 'middleName', 'lastName', 'businessName']) assert.equal(after[k], before[k]);
        assert.equal(after.accounts.length, before.accounts.length);
        return { preserved: true };
      });
    }
    await check(ctx, 'unknown payee is rejected', () => expectCode(ctx, ['payees', 'get', `missing-${randomUUID()}`], ['PAYEE_NOT_FOUND']));
    if (uid) {
      await check(ctx, 'per-payment limit enforced before submission', () => expectCode(ctx, ['pay', '--payee', uid, '--amount', '1.01', '--reference', 'Test'], ['LIMIT_EXCEEDED']));
      await check(ctx, 'overlong payment reference is rejected', () => expectCode(ctx, ['pay', '--payee', uid, '--amount', '0.01', '--reference', 'X'.repeat(19)], ['REFERENCE_TOO_LONG']));
    }
    let payment;
    if (payments) await check(ctx, 'signed 1p initiation and duplicate-confirm protection', async () => {
      if (!uid || !mutable) throw new Skipped('Payee unavailable or awaiting bank approval.');
      if (!loadConfig(ctx.env).config.signing.keyUid) throw new Blocked('Sandbox signing key is not configured.');
      const beforeRecipient = (await ctx.target.call(['accounts', 'balance'])).data.raw.effectiveBalance.minorUnits;
      const preview = await ctx.call(['pay', '--payee', uid, '--amount', '0.01', '--reference', paymentReference]);
      assert.equal(preview.status, 'needs_confirmation');
      const result = (await ctx.call(['confirm', preview.confirmCode])).data;
      assert.ok(result.httpStatus >= 200 && result.httpStatus < 300);
      const paymentOrderUid = result.paymentOrderUid ?? result.result?.paymentOrderUid;
      if (result.actionState === 'awaiting_bank_approval') {
        mutable = false;
        ctx.resources.pendingApprovals.push({ code: preview.confirmCode, httpStatus: result.httpStatus, operation: 'pay', ...result.bankApproval });
      }
      payment = { paymentOrderUid, reference: paymentReference, beforeRecipient, bankApproval: result.bankApproval, target: ctx.target.profile, amountMinor: 1, confirmCode: preview.confirmCode, runId };
      writeFileSync(path.join(ctx.paths.home, 'last-payment-test.json'), JSON.stringify(payment, null, 2) + '\n', { mode: 0o600 });
      const again = (await ctx.call(['confirm', preview.confirmCode])).data;
      assert.equal(again.alreadyExecuted, true);
      return { submittedMinor: 1, signatureAccepted: true, bankApprovalRequired: !!result.bankApproval, hasPaymentOrderUid: !!paymentOrderUid, alreadyExecuted: true };
    });
    if (payments) await check(ctx, 'payment settlement and recipient credit', async () => {
      if (!payment) throw new Skipped('No successful payment initiation.');
      if (payment.bankApproval) throw new Blocked('Signed request accepted, but Starling app consent is pending.');
      let state;
      if (payment.paymentOrderUid) state = (await ctx.call(['payments', 'status', payment.paymentOrderUid])).data.state;
      for (let attempt = 0; attempt < 3; attempt++) {
        const feed = (await ctx.target.call(['transactions', 'list', '--days', '1', '--direction', 'in', '--search', paymentReference, '--limit', '100'])).data.transactions;
        if (feed.some((tx) => tx.reference === paymentReference && tx.amount === '£0.01')) {
          const after = (await ctx.target.call(['accounts', 'balance'])).data.raw.effectiveBalance.minorUnits;
          assert.ok(after >= payment.beforeRecipient + 1); return { recipientCreditedMinor: 1, bankState: state };
        }
      }
      if (state === 'PENDING' || state === 'NOT_YET_PROCESSED') throw new Blocked(`Payment is ${state}; no recipient credit observed yet.`);
      assert.fail('No matching recipient credit after three bounded read checks.');
    });
  } finally {
    if (uid && mutable && !ctx.resources.pendingApprovals.length) await check(ctx, 'payee cleanup', async () => {
      await ctx.confirm(await ctx.call(['payees', 'delete', uid]));
      const list = (await ctx.call(['payees', 'list'])).data.payees;
      assert.ok(!list.some((p) => p.payeeUid === uid));
      ctx.resources.payees = ctx.resources.payees.filter((id) => id !== uid); return { removed: true };
    });
  }
}

async function run() {
  console.log(`Sandbox integration run ${runId}; no model calls. Phase: ${values.phase}.`);
  // Read all counterpart details from sandbox customers, never from live recipient files.
  for (const profile of profiles) {
    const ctx = context(profile); contexts.set(profile, ctx);
    ctx.accounts = (await ctx.call(['accounts', 'list'])).data.accounts;
    assert.equal(ctx.accounts.length, 1, 'Choose a default sandbox account before testing multiple accounts.');
    ctx.account = ctx.accounts[0];
    ctx.holder = (await ctx.call(['accounts', 'holder'])).data;
    ctx.identifiers = (await ctx.call(['accounts', 'identifiers'])).data.identifiers;
    assert.match(ctx.identifiers.accountIdentifier, /^\d{8}$/); assert.match(ctx.identifiers.bankIdentifier, /^\d{6}$/);
  }
  assert.equal(new Set([...contexts.values()].map((c) => c.account.accountUid)).size, profiles.length, 'Each sandbox customer must have a different account.');
  for (const [index, profile] of profiles.entries()) contexts.get(profile).target = contexts.get(profiles[(index + 1) % profiles.length]);
  for (const profile of selected) {
    const ctx = contexts.get(profile);
    if (values.phase === 'all' || values.phase === 'reads') await reads(ctx);
    if (values.phase === 'all' || values.phase === 'writes') { await savings(ctx); await cardsAndNotes(ctx); }
    if (values.phase === 'notes') await notes(ctx);
    if (['all', 'writes', 'payments'].includes(values.phase)) await payeesAndPayments(ctx, values.phase !== 'payments', values.phase !== 'writes');
  }
  report.finishedAt = new Date().toISOString();
  report.counts = Object.fromEntries(['pass', 'fail', 'blocked', 'skipped'].map((s) => [s, report.cases.filter((c) => c.status === s).length]));
  save(); console.log(JSON.stringify({ counts: report.counts, report: path.join(runDir, 'report.json') }));
  process.exitCode = report.counts.fail || report.counts.blocked ? 1 : 0;
}

run().catch((e) => { report.fatal = { code: e.code, message: e.message }; save(); console.error(`Sandbox run stopped: ${e.code ?? ''} ${e.message}`); process.exitCode = 1; });
