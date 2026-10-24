import { listAccounts, resolveAccount } from '../accounts.mjs';
import { parseAmount } from '../money.mjs';
import { display, need, run } from './util.mjs';

const ACCOUNT_OPT = { string: ['account'] };

export const accountsCommands = {
  'accounts list': {
    summary: 'List the accounts this token can see (name, currency, UIDs).',
    usage: 'accounts list',
    options: {},
    async run(ctx) {
      const accounts = await listAccounts(ctx);
      return { accounts, note: 'defaultCategory is the main balance of the account; savings goals and spaces have their own categories.' };
    },
  },

  'accounts balance': {
    summary: 'Show the balance of an account.',
    usage: 'accounts balance [--account <uid|name>]',
    options: ACCOUNT_OPT,
    async run(ctx, { flags }) {
      const account = await resolveAccount(ctx, flags.account);
      const raw = await run(ctx, 'getAccountBalance', { pathParams: { accountUid: account.accountUid } });
      const shown = {};
      for (const [k, v] of Object.entries(raw ?? {})) if (v && typeof v === 'object' && 'minorUnits' in v) shown[k] = display(v);
      return { account: { name: account.name, currency: account.currency }, balances: shown, raw };
    },
  },

  'accounts identifiers': {
    summary: 'Show the sort code, account number, IBAN and BIC for an account (what you give people to pay you).',
    usage: 'accounts identifiers [--account <uid|name>]',
    options: ACCOUNT_OPT,
    async run(ctx, { flags }) {
      const account = await resolveAccount(ctx, flags.account);
      return { account: { name: account.name, currency: account.currency }, identifiers: await run(ctx, 'getAccountIdentifiers', { pathParams: { accountUid: account.accountUid } }) };
    },
  },

  'accounts holder': {
    summary: 'Show the account holder type and name.',
    usage: 'accounts holder',
    options: {},
    async run(ctx) {
      const holder = await run(ctx, 'getAccountHolder');
      let name = null;
      try {
        name = await run(ctx, 'getAccountHolderName');
      } catch {
        /* the name scope is optional */
      }
      return { holder, name };
    },
  },

  'accounts can-afford': {
    summary: 'Check whether an account has at least this much available to spend.',
    usage: 'accounts can-afford <amount> [--account <uid|name>]',
    options: ACCOUNT_OPT,
    async run(ctx, { flags, positionals }) {
      const minor = parseAmount(need(positionals, 0, 'amount'));
      const account = await resolveAccount(ctx, flags.account);
      const res = await run(ctx, 'getConfirmationOfFunds', { pathParams: { accountUid: account.accountUid }, query: { targetAmountInMinorUnits: minor } });
      return { account: { name: account.name, currency: account.currency }, requested: display({ minorUnits: minor, currency: account.currency }), result: res };
    },
  },
};
