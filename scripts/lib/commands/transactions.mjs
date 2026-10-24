import { resolveAccount } from '../accounts.mjs';
import { CliError } from '../errors.mjs';
import { formatMoney } from '../money.mjs';
import { UNTRUSTED_NOTICE, display, need, run, timeRange } from './util.mjs';

const IGNORED_FOR_TOTALS = new Set(['DECLINED', 'REVERSED', 'UPCOMING_CANCELLED']);

function compact(item) {
  return {
    feedItemUid: item.feedItemUid,
    time: item.transactionTime ?? item.settlementTime ?? item.updatedAt,
    direction: item.direction,
    amount: display(item.amount),
    counterparty: item.counterPartyName,
    reference: item.reference,
    status: item.status,
    category: item.spendingCategory,
    source: item.source,
    note: item.userNote,
  };
}

function summarise(items, currency, withBreakdown) {
  const counted = items.filter((i) => !IGNORED_FOR_TOTALS.has(i.status) && i.amount?.currency === currency);
  const sum = (dir) => counted.filter((i) => i.direction === dir).reduce((s, i) => s + i.amount.minorUnits, 0);
  const out = { count: items.length, in: formatMoney(sum('IN'), currency), out: formatMoney(sum('OUT'), currency), net: formatMoney(sum('IN') - sum('OUT'), currency) };
  if (withBreakdown) {
    const by = (keyFn) => {
      const m = new Map();
      for (const i of counted.filter((x) => x.direction === 'OUT')) m.set(keyFn(i) ?? 'UNKNOWN', (m.get(keyFn(i) ?? 'UNKNOWN') ?? 0) + i.amount.minorUnits);
      return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => ({ name: k, spent: formatMoney(v, currency) }));
    };
    out.topSpendingCategories = by((i) => i.spendingCategory);
    out.topCounterparties = by((i) => i.counterPartyName);
  }
  return out;
}

export const transactionsCommands = {
  'transactions list': {
    summary: 'List transactions in a date range, newest first, with totals.',
    usage: 'transactions list [--days 30 | --from YYYY-MM-DD --to YYYY-MM-DD] [--direction in|out] [--search text] [--limit 50] [--summary] [--full] [--account ..] [--category <uid>]',
    options: { string: ['days', 'from', 'to', 'direction', 'search', 'limit', 'account', 'category'], boolean: ['summary', 'full'] },
    async run(ctx, { flags }) {
      const { from, to } = timeRange(flags);
      const account = await resolveAccount(ctx, flags.account);
      const res = await run(ctx, 'queryFeedItemsByCategoryWithTransactionTimesBetween', {
        pathParams: { accountUid: account.accountUid, categoryUid: flags.category ?? account.defaultCategory },
        query: { minTransactionTimestamp: from.toISOString(), maxTransactionTimestamp: to.toISOString() },
      });
      let items = res?.feedItems ?? [];
      if (flags.direction) {
        const want = flags.direction.toUpperCase();
        if (!['IN', 'OUT'].includes(want)) throw new CliError('USAGE', '--direction must be "in" or "out".', { exit: 2 });
        items = items.filter((i) => i.direction === want);
      }
      if (flags.search) {
        const t = flags.search.toLowerCase();
        items = items.filter((i) => [i.counterPartyName, i.reference, i.userNote, i.spendingCategory].some((f) => f?.toLowerCase().includes(t)));
      }
      items.sort((a, b) => Date.parse(b.transactionTime ?? 0) - Date.parse(a.transactionTime ?? 0));
      const limit = Number(flags.limit ?? 50);
      ctx.notices.push(UNTRUSTED_NOTICE);
      return {
        account: { name: account.name, currency: account.currency },
        range: { from: from.toISOString(), to: to.toISOString(), timezone: 'UTC' },
        totals: summarise(items, account.currency, flags.summary),
        shown: Math.min(limit, items.length),
        transactions: items.slice(0, limit).map((i) => (flags.full ? i : compact(i))),
        ...(items.length > limit ? { truncated: `Showing ${limit} of ${items.length}. Use --limit or a narrower range.` } : {}),
      };
    },
  },

  'transactions get': {
    summary: 'Show one transaction in full.',
    usage: 'transactions get <feedItemUid> [--account ..] [--category <uid>]',
    options: { string: ['account', 'category'] },
    async run(ctx, { flags, positionals }) {
      const account = await resolveAccount(ctx, flags.account);
      ctx.notices.push(UNTRUSTED_NOTICE);
      return run(ctx, 'getFeedItem', { pathParams: { accountUid: account.accountUid, categoryUid: flags.category ?? account.defaultCategory, feedItemUid: need(positionals, 0, 'feedItemUid') } });
    },
  },

  'transactions export': {
    summary: 'Download a CSV export of transactions to a file.',
    usage: 'transactions export --out <file.csv> [--days 30 | --from .. --to ..] [--account ..] [--force]',
    options: { string: ['days', 'from', 'to', 'out', 'account'], boolean: ['force'] },
    async run(ctx, { flags }) {
      if (!flags.out) throw new CliError('USAGE', '--out <file.csv> is required.', { exit: 2 });
      const { from, to } = timeRange(flags);
      const account = await resolveAccount(ctx, flags.account);
      // This endpoint takes calendar dates, unlike the feed query's timestamps.
      // timeRange advances a bare --to date by a day for timestamp queries; retain
      // the requested day for the export instead.
      const end = /^\d{4}-\d{2}-\d{2}$/.test(flags.to ?? '') ? flags.to : to.toISOString().slice(0, 10);
      return run(ctx, 'downloadCSVFeedExportForDateRange', { pathParams: { accountUid: account.accountUid }, query: { start: from.toISOString().slice(0, 10), end }, out: flags.out, force: flags.force });
    },
  },

  'transactions note': {
    summary: 'Set or clear the note on a transaction.',
    usage: 'transactions note <feedItemUid> [<text> | --clear] [--account ..] [--category <uid>]',
    options: { string: ['account', 'category'], boolean: ['clear'] },
    async run(ctx, { flags, positionals }) {
      const account = await resolveAccount(ctx, flags.account);
      if (flags.clear && positionals.length > 1) throw new CliError('USAGE', 'Provide text or --clear, not both.', { exit: 2 });
      const userNote = flags.clear ? '' : positionals.slice(1).join(' ');
      if (!flags.clear && !userNote) throw new CliError('USAGE', 'Provide <text> or --clear to remove the note.', { exit: 2 });
      return run(ctx, 'updateUserNote', { pathParams: { accountUid: account.accountUid, categoryUid: flags.category ?? account.defaultCategory, feedItemUid: need(positionals, 0, 'feedItemUid') }, body: { userNote } });
    },
  },

  'transactions categorise': {
    summary: 'Change the spending category of a transaction (e.g. GROCERIES, EATING_OUT).',
    usage: 'transactions categorise <feedItemUid> <CATEGORY> [--account ..] [--category <uid>]',
    options: { string: ['account', 'category'] },
    async run(ctx, { flags, positionals }) {
      const account = await resolveAccount(ctx, flags.account);
      return run(ctx, 'changeTransactionCategory', {
        pathParams: { accountUid: account.accountUid, categoryUid: flags.category ?? account.defaultCategory, feedItemUid: need(positionals, 0, 'feedItemUid') },
        body: { spendingCategory: need(positionals, 1, 'CATEGORY').toUpperCase() },
      });
    },
  },
};
