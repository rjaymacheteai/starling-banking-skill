import { resolveAccount } from './accounts.mjs';
import { getOperation } from './catalogue.mjs';
import { CliError } from './errors.mjs';
import { formatMoney, limitToMinor } from './money.mjs';
import { suppliedRecipientName } from './payee-names.mjs';

// Starling's documented pattern for payment references; FPS (GBP) allows 18 characters, SEPA 35.
const REFERENCE_PATTERN = /^[a-zA-Z0-9\-/?:().,+#=!%&*<>;{@ "']{1,35}$/;

export const maskAccount = (n) => (n ? `****${String(n).slice(-4)}` : '');
export const formatSortCode = (s) => (/^\d{6}$/.test(s ?? '') ? `${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4)}` : s ?? '');

export async function fetchPayees(ctx) {
  if (!ctx.cache.payees) {
    const res = await ctx.client.call(getOperation('getPayees'));
    ctx.cache.payees = res.data?.payees ?? [];
  }
  return ctx.cache.payees;
}

export function describePayeeAccount(payee, account) {
  const where = account.bankIdentifierType === 'SORT_CODE'
    ? `sort code ${formatSortCode(account.bankIdentifier)}, account ${maskAccount(account.accountIdentifier)}`
    : `${account.bankIdentifierType} ${account.bankIdentifier ?? ''} ${maskAccount(account.accountIdentifier)}`.trim();
  const recipientName = suppliedRecipientName(payee);
  return `${payee.payeeName} (${recipientName ? `supplied recipient name: ${recipientName}; ` : ''}${where})`;
}

// Everything that moves money out passes through here, from `pay` and from the generic
// `call` command alike, so no route skips the limits, the allowlist or the payee check.
async function paymentGuard(ctx, request, { excludePlan } = {}) {
  const { pathParams, body } = request;
  if (!body || typeof body !== 'object') throw new CliError('MISSING_BODY', 'A payment needs a request body.');
  if (body.paymentRecipient) {
    throw new CliError('RECIPIENT_NOT_REGISTERED', 'Payments to unregistered account details are not allowed by this skill.', {
      hint: 'Add the recipient first with `payees add`, then pay them using their payee account.',
    });
  }
  if (!body.destinationPayeeAccountUid) {
    throw new CliError('MISSING_PAYEE', 'A payment needs destinationPayeeAccountUid (an existing payee account).', { hint: 'Use `pay --payee <name or uid>`.' });
  }
  const amount = body.amount;
  if (!amount || !Number.isInteger(amount.minorUnits) || amount.minorUnits <= 0 || !/^[A-Z]{3}$/.test(amount.currency ?? '')) {
    throw new CliError('BAD_AMOUNT', 'The amount must be { currency, minorUnits } with a positive whole number of minor units (pence).');
  }
  if (!body.reference || !REFERENCE_PATTERN.test(body.reference)) {
    throw new CliError('BAD_REFERENCE', 'The payment reference is missing or contains characters Starling does not allow.', {
      hint: 'Use letters, digits and basic punctuation, up to 18 characters for GBP payments (35 for EUR).',
    });
  }
  const maxRef = amount.currency === 'GBP' ? 18 : 35;
  if (body.reference.length > maxRef) {
    throw new CliError('REFERENCE_TOO_LONG', `The reference is ${body.reference.length} characters; ${amount.currency} payments allow at most ${maxRef}.`, {
      hint: 'Shorten it. The skill never truncates silently, because the recipient sees exactly what is sent.',
    });
  }

  const { perPayment, perDay, currency } = ctx.config.limits;
  if (perPayment == null || perDay == null) {
    throw new CliError('LIMITS_NOT_SET', 'Payments are enabled but spending limits are not set.', {
      hint: `Set limits.perPayment and limits.perDay in ${ctx.configFile}. Run \`doctor\` for help.`,
    });
  }
  if (amount.currency !== currency) {
    throw new CliError('CURRENCY_NOT_COVERED', `Your spending limits are in ${currency}, but this payment is in ${amount.currency}.`, {
      hint: `Only ${currency} payments can be made until limits.currency matches.`,
    });
  }
  const perPaymentMinor = limitToMinor(perPayment);
  const perDayMinor = limitToMinor(perDay);
  if (amount.minorUnits > perPaymentMinor) {
    throw new CliError('LIMIT_EXCEEDED', `${formatMoney(amount.minorUnits, currency)} is over your per-payment limit of ${formatMoney(perPaymentMinor, currency)}.`, {
      hint: 'The user can raise limits.perPayment in config.json themselves. Do not change it on their behalf unless they explicitly ask.',
    });
  }
  const spent = ctx.ledger.spentToday(currency, new Date(), { excludePlan });
  if (spent + amount.minorUnits > perDayMinor) {
    throw new CliError('LIMIT_EXCEEDED', `This would take today's total to ${formatMoney(spent + amount.minorUnits, currency)}, over your daily limit of ${formatMoney(perDayMinor, currency)} (already sent today: ${formatMoney(spent, currency)}).`, {
      hint: 'The limit resets at midnight local time, or the user can raise limits.perDay in config.json.',
    });
  }

  const payees = await fetchPayees(ctx);
  const payee = payees.find((p) => p.accounts?.some((a) => a.payeeAccountUid === body.destinationPayeeAccountUid));
  if (!payee) {
    throw new CliError('PAYEE_NOT_FOUND', 'That payee account is not one of your registered payees.', { hint: 'Run `payees list` to see who you can pay.' });
  }
  const payeeAccount = payee.accounts.find((a) => a.payeeAccountUid === body.destinationPayeeAccountUid);
  const allowed = ctx.config.allowedPayees;
  if (allowed.length) {
    const ok = allowed.some((x) => x === payee.payeeUid || x.toLowerCase() === payee.payeeName.toLowerCase());
    if (!ok) {
      throw new CliError('PAYEE_NOT_ALLOWED', `${payee.payeeName} is not in your allowedPayees list.`, {
        hint: 'Payments are restricted to the payees named in config.json. The user can add this payee there if they want to allow it.',
      });
    }
  }

  const account = await resolveAccount(ctx, pathParams.accountUid);
  if (account.currency !== amount.currency) {
    throw new CliError('CURRENCY_MISMATCH', `Account "${account.name}" is in ${account.currency}, but the payment is in ${amount.currency}.`);
  }

  const money = formatMoney(amount.minorUnits, amount.currency);
  return {
    summary: `Pay ${money} to ${describePayeeAccount(payee, payeeAccount)}, reference "${body.reference}", from "${account.name}" (${account.currency}).`,
    details: {
      amount: money,
      recipient: payee.payeeName,
      suppliedRecipientName: suppliedRecipientName(payee),
      bankNameCheck: 'not_reported_by_api',
      recipientAccount: describePayeeAccount(payee, payeeAccount),
      reference: body.reference,
      fromAccount: `${account.name} (${account.currency})`,
      limits: { perPayment: formatMoney(perPaymentMinor, currency), perDay: formatMoney(perDayMinor, currency), sentToday: formatMoney(spent, currency), remainingToday: formatMoney(perDayMinor - spent, currency) },
    },
    meta: { kind: 'payment', amountMinor: amount.minorUnits, currency: amount.currency, payeeUid: payee.payeeUid },
  };
}

const GUARDS = {
  makeLocalPayment: paymentGuard,
  createStandingOrder: unsupportedStandingOrder,
  updateStandingOrder: unsupportedStandingOrder,
};

function unsupportedStandingOrder() {
  throw new CliError('UNSUPPORTED_OPERATION', 'Standing-order creation and updates are not supported by this skill.', {
    hint: 'Use the Starling app for recurring payments. This skill does not enforce spending limits on future recurring executions. Listing and cancelling existing standing orders are supported.',
  });
}

export function guardFor(operationId) {
  return GUARDS[operationId] ?? null;
}

// Fills accountUid / categoryUid when the caller leaves them out.
export async function fillAccountParams(ctx, op, pathParams, accountRef) {
  const out = { ...pathParams };
  const needsAccount = op.pathParams.includes('accountUid') && !out.accountUid;
  const needsCategory = op.pathParams.includes('categoryUid') && !out.categoryUid;
  if (needsAccount || needsCategory) {
    const account = await resolveAccount(ctx, accountRef ?? out.accountUid);
    if (needsAccount) out.accountUid = account.accountUid;
    if (needsCategory) out.categoryUid = account.defaultCategory;
  }
  return out;
}
