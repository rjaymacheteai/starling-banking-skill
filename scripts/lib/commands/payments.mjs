import crypto from 'node:crypto';
import { resolveAccount } from '../accounts.mjs';
import { cancelPlan, confirmPlan, runOperation } from '../engine.mjs';
import { CliError, usage } from '../errors.mjs';
import { parseAmount } from '../money.mjs';
import { findPayee, pickPayeeAccount } from './payees.mjs';
import { need, run } from './util.mjs';

export const paymentsCommands = {
  pay: {
    summary: 'Prepare a payment to an existing payee. Nothing is sent until `confirm <code>` is run.',
    usage: 'pay --payee <name|payeeUid> --amount <25.00> --reference <text> [--payee-account <uid>] [--account <uid|name>]',
    options: { string: ['payee', 'amount', 'reference', 'payee-account', 'account', 'currency'] },
    async run(ctx, { flags }) {
      for (const f of ['payee', 'amount', 'reference']) if (!flags[f]) throw usage(`--${f} is required.`);
      const payee = await findPayee(ctx, flags.payee);
      const payeeAccount = pickPayeeAccount(payee, flags['payee-account']);
      const account = await resolveAccount(ctx, flags.account);
      const currency = flags.currency ?? account.currency;
      const body = {
        externalIdentifier: crypto.randomUUID(), // fixed at preview time, so a retry can never become a second payment
        destinationPayeeAccountUid: payeeAccount.payeeAccountUid,
        reference: flags.reference,
        amount: { currency, minorUnits: parseAmount(flags.amount) },
      };
      return runOperation(ctx, 'makeLocalPayment', { pathParams: { accountUid: account.accountUid, categoryUid: account.defaultCategory }, body });
    },
  },

  confirm: {
    summary: 'Carry out a prepared action after the user has approved it.',
    usage: 'confirm <code> [--retry]',
    options: { boolean: ['retry'] },
    async run(ctx, { flags, positionals }) {
      const { status, ...rest } = await confirmPlan(ctx, need(positionals, 0, 'code'), { retry: flags.retry });
      return rest;
    },
  },

  cancel: {
    summary: 'Discard a prepared action without running it.',
    usage: 'cancel <code>',
    options: {},
    async run(ctx, { positionals }) {
      const { status, ...rest } = cancelPlan(ctx, need(positionals, 0, 'code'));
      return rest;
    },
  },

  'payments status': {
    summary: 'Check what happened to a payment (use the paymentOrderUid from `confirm`).',
    usage: 'payments status <paymentOrderUid>',
    options: {},
    async run(ctx, { positionals }) {
      const uid = need(positionals, 0, 'paymentOrderUid');
      async function lookup(operationId) {
        try {
          const result = await runOperation(ctx, operationId, { pathParams: { paymentOrderUid: uid } });
          return { data: result.result, info: { ok: true, httpStatus: result.httpStatus } };
        } catch (e) {
          if (!(e instanceof CliError)) throw e;
          return { error: e, info: { ok: false, httpStatus: e.details?.status, errorCode: e.code, message: e.message } };
        }
      }
      // The payments collection can return 200 even while the order returns 404.
      // Query independently; an order lookup failure must not hide execution status.
      const orderLookup = await lookup('getPaymentOrder');
      const paymentsLookup = await lookup('getPaymentOrderPayments');
      if (orderLookup.error && paymentsLookup.error) {
        if (orderLookup.error.code === 'NOT_FOUND') orderLookup.error.hint = 'The order and its payments could not be retrieved. A 404 does not by itself establish whether an app consent is unanswered, declined or invalid. Check the app and transactions; do not resubmit automatically.';
        throw orderLookup.error;
      }
      const order = orderLookup.data ?? null;
      const payments = Array.isArray(paymentsLookup.data?.payments) ? paymentsLookup.data.payments : null;
      const states = (payments ?? []).map((p) => p.paymentStatusDetails?.paymentStatus).filter(Boolean);
      const state = payments === null ? 'UNKNOWN'
        : states.includes('REJECTED') ? 'REJECTED'
        : states.includes('PENDING') ? 'PENDING'
        : states.length && states.length === payments.length && states.every((s) => s === 'ACCEPTED') ? 'ACCEPTED'
        : payments.length === 0 ? (order ? 'NOT_YET_PROCESSED' : 'UNRESOLVED') : 'UNKNOWN';
      return { paymentOrderUid: uid, state, explanation: STATE_TEXT[state], order, payments, lookups: { order: orderLookup.info, payments: paymentsLookup.info } };
    },
  },

  'payments standing-orders': {
    summary: 'List standing orders on an account.',
    usage: 'payments standing-orders [--account ..]',
    options: { string: ['account'] },
    async run(ctx, { flags }) {
      const account = await resolveAccount(ctx, flags.account);
      return run(ctx, 'listStandingOrders', { pathParams: { accountUid: account.accountUid, categoryUid: account.defaultCategory } });
    },
  },

  'payments cancel-standing-order': {
    summary: 'Cancel a standing order (needs confirmation and a signing key).',
    usage: 'payments cancel-standing-order <paymentOrderUid> [--account ..]',
    options: { string: ['account'] },
    async run(ctx, { flags, positionals }) {
      const account = await resolveAccount(ctx, flags.account);
      const uid = need(positionals, 0, 'paymentOrderUid');
      return runOperation(ctx, 'cancelStandingOrder', {
        pathParams: { accountUid: account.accountUid, categoryUid: account.defaultCategory, paymentOrderUid: uid },
        summary: `Cancel standing order ${uid} on "${account.name}". Future payments from it will stop.`,
        details: { paymentOrderUid: uid, account: account.name },
      });
    },
  },

  log: {
    summary: 'Show what this skill has sent from this computer (local record, newest first).',
    usage: 'log [--limit 20]',
    options: { string: ['limit'] },
    async run(ctx, { flags }) {
      const limit = Number(flags.limit ?? 20);
      const entries = ctx.ledger.entries().slice(-limit).reverse();
      return { count: entries.length, entries, note: 'This is a local record of requests the skill made. Starling remains the source of truth for balances and payment results.' };
    },
  },
};

const STATE_TEXT = {
  ACCEPTED: 'Starling accepted the payment.',
  PENDING: 'The payment is pending. Starling may be reviewing it or waiting for approval in the Starling app.',
  REJECTED: 'Starling rejected the payment. See the reason in payments[].paymentStatusDetails.',
  NOT_YET_PROCESSED: 'No payment has been created for this order yet. Check again shortly.',
  UNRESOLVED: 'The order is unavailable and its payments list is empty. These endpoints cannot determine whether app approval is unanswered, declined, expired or the order UID is invalid. Check the app and outgoing transactions; do not resubmit automatically.',
  UNKNOWN: 'Payment execution status could not be established. Inspect lookups for the endpoint results and check the app or transactions before retrying anything.',
};
