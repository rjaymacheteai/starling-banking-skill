import crypto from 'node:crypto';
import { resolveAccount } from '../accounts.mjs';
import { CliError, usage } from '../errors.mjs';
import { parseAmount } from '../money.mjs';
import { runOperation } from '../engine.mjs';
import { display, need, run } from './util.mjs';

// ---- cards -------------------------------------------------------------------------------

const CONTROLS = {
  atm: 'enableAtm',
  online: 'enableOnlinePayments',
  pos: 'enablePos',
  'mobile-wallet': 'enableMobileWallet',
  'mag-stripe': 'enableMagStripePayment',
  gambling: 'enableGamblingPayments',
};

async function cardUid(ctx, ref) {
  if (ref) return ref;
  const cards = (await run(ctx, 'listCards'))?.cards ?? [];
  const live = cards.filter((c) => !c.cancelled);
  if (live.length === 1) return live[0].cardUid;
  throw new CliError('AMBIGUOUS_CARD', live.length ? 'More than one card, so say which one.' : 'No active cards found.', {
    hint: 'Pass the card UID (see `cards list`).',
    details: { cards: live.map((c) => ({ cardUid: c.cardUid, endOfCardNumber: c.endOfCardNumber })) },
  });
}

const onOff = (word) => {
  if (['on', 'true', 'enable'].includes(word)) return true;
  if (['off', 'false', 'disable'].includes(word)) return false;
  throw usage(`Expected "on" or "off", got "${word}".`);
};

export const cardsCommands = {
  'cards list': {
    summary: 'List cards and which controls are switched on.',
    usage: 'cards list',
    options: {},
    async run(ctx) {
      const res = await run(ctx, 'listCards');
      return { cards: (res?.cards ?? []).map((c) => ({ cardUid: c.cardUid, endOfCardNumber: c.endOfCardNumber, unlocked: c.enabled, cancelled: c.cancelled, activated: c.activated, contactlessAndChipPin: c.posEnabled, atm: c.atmEnabled, online: c.onlineEnabled, mobileWallet: c.mobileWalletEnabled, gambling: c.gamblingEnabled, magStripe: c.magStripeEnabled })) };
    },
  },
  'cards lock': {
    summary: 'Lock a card (blocks all payments until unlocked).',
    usage: 'cards lock [<cardUid>]',
    options: {},
    async run(ctx, { positionals }) {
      return run(ctx, 'enableCard', { pathParams: { cardUid: await cardUid(ctx, positionals[0]) }, body: { enabled: false } });
    },
  },
  'cards unlock': {
    summary: 'Unlock a card.',
    usage: 'cards unlock [<cardUid>]',
    options: {},
    async run(ctx, { positionals }) {
      return run(ctx, 'enableCard', { pathParams: { cardUid: await cardUid(ctx, positionals[0]) }, body: { enabled: true } });
    },
  },
  'cards set': {
    summary: `Switch a card control on or off. Controls: ${Object.keys(CONTROLS).join(', ')}.`,
    usage: 'cards set <control> <on|off> [--card <cardUid>]',
    options: { string: ['card'] },
    async run(ctx, { flags, positionals }) {
      const control = need(positionals, 0, 'control');
      if (!CONTROLS[control]) throw usage(`Unknown control "${control}".`, `Choose one of: ${Object.keys(CONTROLS).join(', ')}.`);
      return run(ctx, CONTROLS[control], { pathParams: { cardUid: await cardUid(ctx, flags.card) }, body: { enabled: onOff(need(positionals, 1, 'on|off')) } });
    },
  },
};

// ---- savings goals and spaces --------------------------------------------------------------

export const savingsCommands = {
  'goals list': {
    summary: 'List savings goals.',
    usage: 'goals list [--account ..]',
    options: { string: ['account'] },
    async run(ctx, { flags }) {
      const account = await resolveAccount(ctx, flags.account);
      const res = await run(ctx, 'getSavingsGoals', { pathParams: { accountUid: account.accountUid } });
      return { account: { name: account.name }, goals: (res?.savingsGoalList ?? []).map((g) => ({ savingsGoalUid: g.savingsGoalUid, name: g.name, state: g.state, saved: display(g.totalSaved), target: display(g.target), percent: g.savedPercentage })) };
    },
  },
  'goals get': {
    summary: 'Show one savings goal.',
    usage: 'goals get <savingsGoalUid> [--account ..]',
    options: { string: ['account'] },
    async run(ctx, { flags, positionals }) {
      const account = await resolveAccount(ctx, flags.account);
      return run(ctx, 'getSavingsGoal', { pathParams: { accountUid: account.accountUid, savingsGoalUid: need(positionals, 0, 'savingsGoalUid') } });
    },
  },
  'goals create': {
    summary: 'Create a savings goal.',
    usage: 'goals create --name <name> [--target <amount>] [--account ..]',
    options: { string: ['name', 'target', 'account'] },
    async run(ctx, { flags }) {
      if (!flags.name) throw usage('--name is required.');
      const account = await resolveAccount(ctx, flags.account);
      const body = { name: flags.name, currency: account.currency };
      if (flags.target) body.target = { currency: account.currency, minorUnits: parseAmount(flags.target) };
      return run(ctx, 'createSavingsGoal', { pathParams: { accountUid: account.accountUid }, body });
    },
  },
  'goals add': {
    summary: 'Move money from the account into a savings goal.',
    usage: 'goals add <savingsGoalUid> --amount <amount> [--account ..]',
    options: { string: ['amount', 'account'] },
    async run(ctx, { flags, positionals }) {
      if (!flags.amount) throw usage('--amount is required.');
      const account = await resolveAccount(ctx, flags.account);
      return run(ctx, 'addMoney', { pathParams: { accountUid: account.accountUid, savingsGoalUid: need(positionals, 0, 'savingsGoalUid'), transferUid: crypto.randomUUID() }, body: { amount: { currency: account.currency, minorUnits: parseAmount(flags.amount) } } });
    },
  },
  'goals withdraw': {
    summary: 'Move money from a savings goal back to the account.',
    usage: 'goals withdraw <savingsGoalUid> --amount <amount> [--account ..]',
    options: { string: ['amount', 'account'] },
    async run(ctx, { flags, positionals }) {
      if (!flags.amount) throw usage('--amount is required.');
      const account = await resolveAccount(ctx, flags.account);
      return run(ctx, 'withdrawMoney', { pathParams: { accountUid: account.accountUid, savingsGoalUid: need(positionals, 0, 'savingsGoalUid'), transferUid: crypto.randomUUID() }, body: { amount: { currency: account.currency, minorUnits: parseAmount(flags.amount) } } });
    },
  },
  'goals delete': {
    summary: 'Delete a savings goal (money in it returns to the account).',
    usage: 'goals delete <savingsGoalUid> [--account ..]',
    options: { string: ['account'] },
    async run(ctx, { flags, positionals }) {
      const account = await resolveAccount(ctx, flags.account);
      return run(ctx, 'deleteSavingsGoal', { pathParams: { accountUid: account.accountUid, savingsGoalUid: need(positionals, 0, 'savingsGoalUid') } });
    },
  },
  'spaces list': {
    summary: 'List savings and spending spaces.',
    usage: 'spaces list [--account ..]',
    options: { string: ['account'] },
    async run(ctx, { flags }) {
      const account = await resolveAccount(ctx, flags.account);
      return run(ctx, 'getSpaces', { pathParams: { accountUid: account.accountUid } });
    },
  },
};

// ---- direct debit mandates -----------------------------------------------------------------

export const mandatesCommands = {
  'mandates list': {
    summary: 'List direct debit mandates.',
    usage: 'mandates list',
    options: {},
    async run(ctx) {
      const res = await run(ctx, 'listMandates');
      return { mandates: (res?.mandates ?? []).map((m) => ({ uid: m.uid, originator: m.originatorName, reference: m.reference, status: m.status, nextDate: m.nextDate, lastDate: m.lastDate, lastPayment: display(m.lastPayment) })) };
    },
  },
  'mandates get': {
    summary: 'Show one direct debit mandate.',
    usage: 'mandates get <mandateUid>',
    options: {},
    async run(ctx, { positionals }) {
      return run(ctx, 'getMandate', { pathParams: { mandateUid: need(positionals, 0, 'mandateUid') } });
    },
  },
  'mandates cancel': {
    summary: 'Cancel a direct debit mandate (needs confirmation).',
    usage: 'mandates cancel <mandateUid>',
    options: {},
    async run(ctx, { positionals }) {
      const uid = need(positionals, 0, 'mandateUid');
      let who = uid;
      try {
        const m = await run(ctx, 'getMandate', { pathParams: { mandateUid: uid } });
        who = `${m.originatorName ?? 'unknown company'} (reference ${m.reference ?? 'none'}, status ${m.status})`;
      } catch {
        /* still allow the preview; the cancel itself will report any problem */
      }
      return runOperation(ctx, 'cancelMandate', { pathParams: { mandateUid: uid }, summary: `Cancel the direct debit mandate for ${who}. The company will no longer be able to collect payments.`, details: { mandateUid: uid, mandate: who } });
    },
  },
};
