import { getOperation } from './catalogue.mjs';
import { CliError } from './errors.mjs';

export async function listAccounts(ctx) {
  if (!ctx.cache.accounts) {
    const res = await ctx.client.call(getOperation('getAccounts'));
    ctx.cache.accounts = res.data?.accounts ?? [];
  }
  return ctx.cache.accounts;
}

const brief = (a) => ({ accountUid: a.accountUid, name: a.name, accountType: a.accountType, currency: a.currency });

// Picks the account a command acts on. `ref` may be an account UID or a name.
// With several accounts and no default, we ask rather than guess: acting on the wrong
// account is the one mistake that is hard to spot afterwards.
export async function resolveAccount(ctx, ref) {
  const accounts = await listAccounts(ctx);
  if (!accounts.length) throw new CliError('NO_ACCOUNTS', 'This token cannot see any accounts.', { hint: 'The token needs the account:read (or account-list:read) scope.' });

  const wanted = ref ?? ctx.config.defaultAccountUid;
  if (wanted) {
    const hit = accounts.find((a) => a.accountUid === wanted) ?? accounts.filter((a) => a.name?.toLowerCase() === String(wanted).toLowerCase());
    const found = Array.isArray(hit) ? (hit.length === 1 ? hit[0] : null) : hit;
    if (!found) {
      throw new CliError('ACCOUNT_NOT_FOUND', `No account matches "${wanted}".`, { hint: 'Run `accounts list` to see the accounts this token can use.', details: { accounts: accounts.map(brief) } });
    }
    return found;
  }
  if (accounts.length === 1) return accounts[0];
  const primary = accounts.filter((a) => a.accountType === 'PRIMARY');
  if (primary.length === 1) return primary[0];
  throw new CliError('AMBIGUOUS_ACCOUNT', 'More than one account is available, so you need to say which one.', {
    hint: 'Pass --account <uid or name>, or set defaultAccountUid in config.json.',
    details: { accounts: accounts.map(brief) },
  });
}
