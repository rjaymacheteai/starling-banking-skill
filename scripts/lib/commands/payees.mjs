import { CliError, usage } from '../errors.mjs';
import { fetchPayees, formatSortCode, maskAccount } from '../guards.mjs';
import { runOperation } from '../engine.mjs';
import { UNTRUSTED_NOTICE, need, run, timeRange } from './util.mjs';
import { NAME_FLAGS, editablePayee, namePreview, payeeNameChanges, suppliedRecipientName } from '../payee-names.mjs';

function shapePayee(p, reveal) {
  return {
    payeeUid: p.payeeUid,
    payeeName: p.payeeName,
    payeeType: p.payeeType,
    firstName: p.firstName ?? null,
    middleName: p.middleName ?? null,
    lastName: p.lastName ?? null,
    businessName: p.businessName ?? null,
    suppliedRecipientName: suppliedRecipientName(p),
    bankNameCheck: 'not_reported_by_api',
    accounts: (p.accounts ?? []).map((a) => ({
      payeeAccountUid: a.payeeAccountUid,
      description: a.description,
      defaultAccount: a.defaultAccount,
      channel: a.payeeChannelType,
      country: a.countryCode,
      type: a.bankIdentifierType,
      bankIdentifier: a.bankIdentifierType === 'SORT_CODE' ? formatSortCode(a.bankIdentifier) : a.bankIdentifier,
      accountNumber: reveal ? a.accountIdentifier : maskAccount(a.accountIdentifier),
    })),
  };
}

// Finds one payee by UID or exact name. Several matches, or none, is an error that lists the
// candidates: a payment must never go to a guess.
export async function findPayee(ctx, ref) {
  const payees = await fetchPayees(ctx);
  const byUid = payees.find((p) => p.payeeUid === ref);
  if (byUid) return byUid;
  const exact = payees.filter((p) => p.payeeName?.toLowerCase() === ref.toLowerCase());
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new CliError('AMBIGUOUS_PAYEE', `More than one payee is called "${ref}".`, {
      hint: 'Ask the user which one, then use its payeeUid.',
      details: { candidates: exact.map((p) => shapePayee(p, false)) },
    });
  }
  const near = payees.filter((p) => p.payeeName?.toLowerCase().includes(ref.toLowerCase()));
  throw new CliError('PAYEE_NOT_FOUND', `No payee is called "${ref}".`, {
    hint: near.length ? 'Did the user mean one of the similar payees below? Ask them, do not guess.' : 'Run `payees list` to see who is registered. To pay someone new, add them with `payees add` first.',
    details: { similar: near.map((p) => ({ payeeUid: p.payeeUid, payeeName: p.payeeName })) },
  });
}

function pickPayeeAccount(payee, wantedUid) {
  const accounts = (payee.accounts ?? []).filter((a) => a.payeeChannelType === 'BANK_ACCOUNT');
  if (wantedUid) {
    const hit = accounts.find((a) => a.payeeAccountUid === wantedUid);
    if (!hit) throw new CliError('PAYEE_ACCOUNT_NOT_FOUND', `${payee.payeeName} has no bank account with that UID.`, { details: { accounts: accounts.map((a) => ({ payeeAccountUid: a.payeeAccountUid, description: a.description })) } });
    return hit;
  }
  if (accounts.length === 1) return accounts[0];
  const defaults = accounts.filter((a) => a.defaultAccount);
  if (defaults.length === 1) return defaults[0];
  throw new CliError(accounts.length ? 'AMBIGUOUS_PAYEE_ACCOUNT' : 'PAYEE_HAS_NO_BANK_ACCOUNT', accounts.length ? `${payee.payeeName} has several bank accounts and none is the single default.` : `${payee.payeeName} has no bank account to pay.`, {
    hint: accounts.length ? 'Ask the user which account, then pass --payee-account <payeeAccountUid>.' : 'Add one with `payees add-account`.',
    details: { accounts: accounts.map((a) => ({ payeeAccountUid: a.payeeAccountUid, description: a.description, bankIdentifier: a.bankIdentifier, accountNumber: maskAccount(a.accountIdentifier) })) },
  });
}

function accountBody(flags) {
  const sortCode = (flags['sort-code'] ?? '').replace(/[\s-]/g, '');
  const number = (flags['account-number'] ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(sortCode)) throw usage('--sort-code must be 6 digits, e.g. 12-34-56.', 'Only UK sort code + account number is supported by this command; use `call createPayee` for other kinds.');
  if (!/^\d{8}$/.test(number)) throw usage('--account-number must be 8 digits.');
  return {
    description: flags.description ?? 'Main account',
    defaultAccount: true,
    countryCode: 'GB',
    accountIdentifier: number,
    bankIdentifier: sortCode,
    bankIdentifierType: 'SORT_CODE',
  };
}

const ACCOUNT_FLAGS = ['sort-code', 'account-number', 'description'];

export const payeesCommands = {
  'payees list': {
    summary: 'List registered payees. Use --name to check whether someone is registered. Account numbers are masked unless --reveal.',
    usage: 'payees list [--name <text>] [--reveal]',
    options: { string: ['name'], boolean: ['reveal'] },
    async run(ctx, { flags }) {
      let payees = await fetchPayees(ctx);
      if (flags.name) payees = payees.filter((p) => p.payeeName?.toLowerCase().includes(flags.name.toLowerCase()));
      ctx.notices.push(UNTRUSTED_NOTICE);
      return { count: payees.length, ...(flags.name ? { exists: payees.length > 0 } : {}), payees: payees.map((p) => shapePayee(p, flags.reveal)) };
    },
  },

  'payees get': {
    summary: 'Show one payee (by name or UID) with their bank accounts.',
    usage: 'payees get <name|payeeUid> [--reveal]',
    options: { boolean: ['reveal'] },
    async run(ctx, { flags, positionals }) {
      const payee = await findPayee(ctx, need(positionals, 0, 'name|payeeUid'));
      ctx.notices.push(UNTRUSTED_NOTICE);
      return shapePayee(payee, flags.reveal);
    },
  },

  'payees history': {
    summary: 'Show payments made to a payee since a date.',
    usage: 'payees history <name|payeeUid> [--days 90 | --from YYYY-MM-DD] [--payee-account <uid>]',
    options: { string: ['days', 'from', 'to', 'payee-account'] },
    async run(ctx, { flags, positionals }) {
      const payee = await findPayee(ctx, need(positionals, 0, 'name|payeeUid'));
      const account = pickPayeeAccount(payee, flags['payee-account']);
      const { from } = timeRange({ ...flags, days: flags.days ?? 90 });
      ctx.notices.push(UNTRUSTED_NOTICE);
      return run(ctx, 'listPaymentsForPayeeAccount', { pathParams: { payeeUid: payee.payeeUid, accountUid: account.payeeAccountUid }, query: { since: from.toISOString().slice(0, 10) } });
    },
  },

  'payees add': {
    summary: 'Register a new payee with a UK bank account (needs confirmation).',
    usage: 'payees add --sort-code <123456> --account-number <12345678> [--display-name <label> | --name <label>] [--first-name <name>] [--middle-name <name>] [--last-name <name>] [--type individual|business] [--business-name <name>] [--description <text>]',
    options: { string: [...NAME_FLAGS, 'type', ...ACCOUNT_FLAGS] },
    async run(ctx, { flags }) {
      const type = (flags.type ?? 'individual').toUpperCase();
      if (!['INDIVIDUAL', 'BUSINESS'].includes(type)) throw usage('--type must be individual or business.');
      const names = payeeNameChanges(flags, type);
      const label = names.payeeName ?? suppliedRecipientName({ ...names, payeeType: type });
      if (!label) throw usage('Provide --display-name (or --name), or supply recipient name fields to use as the display name.');
      const account = accountBody(flags);
      const body = { ...names, payeeName: label, payeeType: type, accounts: [account] };

      const existing = await fetchPayees(ctx);
      const sameName = existing.filter((p) => p.payeeName?.toLowerCase() === label.toLowerCase());
      const sameAccount = existing.filter((p) => p.accounts?.some((a) => a.accountIdentifier === account.accountIdentifier && a.bankIdentifier === account.bankIdentifier));
      const warnings = [];
      if (sameName.length) warnings.push(`A payee called "${label}" already exists.`);
      if (sameAccount.length) warnings.push(`These account details already belong to: ${sameAccount.map((p) => p.payeeName).join(', ')}.`);

      return runOperation(ctx, 'createPayee', {
        body,
        summary: `Register a new ${type.toLowerCase()} payee with display name "${label}", sort code ${formatSortCode(account.bankIdentifier)}, account number ${account.accountIdentifier}. ${namePreview(body)} Check these details against a trusted source (not just a message) before approving: money sent to wrong details may not be recoverable.`,
        details: { ...names, payeeName: label, payeeType: type, suppliedRecipientName: suppliedRecipientName(body), bankNameCheck: 'not_reported_by_api', sortCode: formatSortCode(account.bankIdentifier), accountNumber: account.accountIdentifier, description: account.description, warnings },
      });
    },
  },

  'payees add-account': {
    summary: 'Add another UK bank account to an existing payee (needs confirmation).',
    usage: 'payees add-account <name|payeeUid> --sort-code <123456> --account-number <12345678> [--description <text>]',
    options: { string: ACCOUNT_FLAGS },
    async run(ctx, { flags, positionals }) {
      const payee = await findPayee(ctx, need(positionals, 0, 'name|payeeUid'));
      const account = { ...accountBody(flags), defaultAccount: false };
      return runOperation(ctx, 'createPayeeAccount', {
        pathParams: { payeeUid: payee.payeeUid },
        body: account,
        summary: `Add a bank account to existing payee "${payee.payeeName}": sort code ${formatSortCode(account.bankIdentifier)}, account number ${account.accountIdentifier}. Check these details against a trusted source before approving.`,
        details: { payee: payee.payeeName, sortCode: formatSortCode(account.bankIdentifier), accountNumber: account.accountIdentifier, description: account.description },
      });
    },
  },

  'payees rename': {
    summary: 'Change a payee\'s name (needs confirmation).',
    usage: 'payees rename <name|payeeUid> --name <new name>',
    options: { string: ['name'] },
    async run(ctx, { flags, positionals }) {
      if (!flags.name) throw usage('--name is required.');
      const payee = await findPayee(ctx, need(positionals, 0, 'name|payeeUid'));
      return runOperation(ctx, 'updatePayee', {
        pathParams: { payeeUid: payee.payeeUid },
        body: { ...editablePayee(payee), ...payeeNameChanges(flags, payee.payeeType) },
        summary: `Rename payee "${payee.payeeName}" to "${flags.name}".`,
        details: { payeeUid: payee.payeeUid, from: payee.payeeName, to: flags.name },
      });
    },
  },

  'payees update': {
    summary: 'Update a payee display label or supplied recipient name (needs confirmation; does not verify the bank name).',
    usage: 'payees update <name|payeeUid> [--display-name <label>] [--first-name <name>] [--middle-name <name>] [--last-name <name>] [--business-name <name>]',
    options: { string: NAME_FLAGS },
    async run(ctx, { flags, positionals }) {
      if (!NAME_FLAGS.some((key) => flags[key] !== undefined)) throw usage('Provide at least one display or recipient name field to update.');
      const payee = await findPayee(ctx, need(positionals, 0, 'name|payeeUid'));
      const changes = payeeNameChanges(flags, payee.payeeType);
      const body = { ...editablePayee(payee), ...changes };
      return runOperation(ctx, 'updatePayee', {
        pathParams: { payeeUid: payee.payeeUid },
        body,
        summary: `Update payee "${payee.payeeName}" (display name after update: "${body.payeeName}"). ${namePreview(body)}`,
        details: { payeeUid: payee.payeeUid, changes, suppliedRecipientName: suppliedRecipientName(body), bankNameCheck: 'not_reported_by_api' },
      });
    },
  },

  'payees delete': {
    summary: 'Delete a payee and its saved accounts (needs confirmation).',
    usage: 'payees delete <name|payeeUid>',
    options: {},
    async run(ctx, { positionals }) {
      const payee = await findPayee(ctx, need(positionals, 0, 'name|payeeUid'));
      return runOperation(ctx, 'deletePayee', {
        pathParams: { payeeUid: payee.payeeUid },
        summary: `Delete payee "${payee.payeeName}" and ${(payee.accounts ?? []).length} saved account(s). They would need to be added again before you can pay them.`,
        details: { payeeUid: payee.payeeUid, payeeName: payee.payeeName },
      });
    },
  },
};

export { pickPayeeAccount };
