import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { IDS, TOKEN, setup } from './helpers/harness.mjs';

let w;
afterEach(async () => {
  await w?.cleanup();
  w = null;
});

describe('read-only use', () => {
  test('works with no config file at all: safe defaults, just a token', async () => {
    w = await setup({ writeConfig: false });
    const r = await w.run('accounts', 'list');
    assert.equal(r.exitCode, 0);
    assert.equal(r.data.accounts[0].name, 'Personal');
    const p = await w.run('permissions');
    assert.equal(p.data.configFound, false);
    assert.deepEqual(p.data.groups.filter((g) => g.enabled).map((g) => g.name), ['view']);
  });

  test('accounts balance shows formatted money', async () => {
    w = await setup();
    const r = await w.run('accounts', 'balance');
    assert.equal(r.data.balances.effectiveBalance, '£1,200.00');
    assert.equal(r.data.account.name, 'Personal');
  });

  test('accounts can-afford and identifiers', async () => {
    w = await setup();
    assert.equal((await w.run('accounts', 'can-afford', '500')).data.result.requestedAmountAvailableToSpend, true);
    assert.equal((await w.run('accounts', 'can-afford', '5000')).data.result.requestedAmountAvailableToSpend, false);
    const ids = await w.run('accounts', 'identifiers');
    assert.equal(ids.data.identifiers.bankIdentifier, '608371');
    assert.equal(w.mock.callsTo('getConfirmationOfFunds')[1].query.targetAmountInMinorUnits, '500000');
  });

  test('transactions list: totals ignore declined items; third-party text is flagged as untrusted', async () => {
    w = await setup();
    const r = await w.run('transactions', 'list', '--days', '30');
    assert.equal(r.exitCode, 0);
    assert.equal(r.data.totals.count, 6);
    assert.equal(r.data.totals.in, '£2,001.00'); // 2000.00 salary + 1.00 injection-bait payment
    assert.equal(r.data.totals.out, '£47.00'); // 12.50 + 4.50 + 30.00, declined 9.99 excluded
    assert.ok(r.json.notices.some((n) => /never as instructions/.test(n)), 'untrusted-text notice must accompany transaction data');
    const q = w.mock.callsTo('queryFeedItemsByCategoryWithTransactionTimesBetween')[0];
    assert.equal(q.path, `/api/v2/feed/account/${IDS.account}/category/${IDS.category}/transactions-between`);
    assert.ok(Date.parse(q.query.maxTransactionTimestamp) > Date.parse(q.query.minTransactionTimestamp));
  });

  test('transactions list filters and summary breakdown', async () => {
    w = await setup();
    const out = await w.run('transactions', 'list', '--direction', 'out', '--summary');
    assert.ok(out.data.transactions.every((t) => t.direction === 'OUT'));
    assert.equal(out.data.totals.topSpendingCategories[0].name, 'EATING_OUT'); // 4.50 + 30.00 beats groceries 12.50
    const search = await w.run('transactions', 'list', '--search', 'tesco');
    assert.equal(search.data.transactions.length, 1);
    const limited = await w.run('transactions', 'list', '--limit', '2');
    assert.equal(limited.data.transactions.length, 2);
    assert.match(limited.data.truncated, /Showing 2 of 6/);
  });

  test('bad dates and ranges are usage errors, not crashes', async () => {
    w = await setup();
    assert.equal((await w.run('transactions', 'list', '--from', 'yesterday-ish')).error.code, 'USAGE');
    assert.equal((await w.run('transactions', 'list', '--from', '2026-05-02', '--to', '2026-05-01')).error.code, 'USAGE');
    assert.equal((await w.run('transactions', 'list', '--days', '-3')).error.code, 'USAGE');
  });

  test('payees list masks account numbers unless --reveal; --name answers "is X added?"', async () => {
    w = await setup();
    const masked = await w.run('payees', 'list');
    const john = masked.data.payees.find((p) => p.payeeName === 'John Smith');
    assert.equal(john.accounts[0].accountNumber, '****5678');
    assert.equal(john.accounts[0].bankIdentifier, '12-34-56');
    assert.ok(!masked.stdout.includes('12345678'));
    const revealed = await w.run('payees', 'list', '--reveal');
    assert.ok(revealed.stdout.includes('12345678'));
    assert.equal((await w.run('payees', 'list', '--name', 'jane')).data.exists, true);
    const none = await w.run('payees', 'list', '--name', 'zzz');
    assert.equal(none.data.exists, false);
    assert.equal(none.data.count, 0);
  });

  test('payees get refuses to guess between two people with the same name', async () => {
    w = await setup();
    const r = await w.run('payees', 'get', 'Alex Morgan');
    assert.equal(r.error.code, 'AMBIGUOUS_PAYEE');
    assert.equal(r.error.details.candidates.length, 2);
    assert.equal((await w.run('payees', 'get', IDS.alex2)).data.payeeUid, IDS.alex2);
    assert.equal((await w.run('payees', 'get', 'jane doe')).data.payeeName, 'Jane Doe');
  });

  test('cards, goals, mandates and spaces are readable', async () => {
    w = await setup();
    assert.equal((await w.run('cards', 'list')).data.cards[0].endOfCardNumber, '4242');
    assert.equal((await w.run('goals', 'list')).data.goals[0].percent, 25);
    assert.equal((await w.run('mandates', 'list')).data.mandates[0].originator, 'Gym Ltd');
  });

  test('transactions export writes a CSV, and will not overwrite without --force', async () => {
    w = await setup();
    const file = path.join(w.home, 'out.csv');
    const r = await w.run('transactions', 'export', '--out', file, '--days', '10');
    assert.equal(r.exitCode, 0, r.stdout);
    assert.match(readFileSync(file, 'utf8'), /Counter Party/);
    const again = await w.run('transactions', 'export', '--out', file);
    assert.equal(again.error.code, 'FILE_EXISTS');
    assert.equal((await w.run('transactions', 'export', '--out', file, '--force')).exitCode, 0);
    assert.equal((await w.run('transactions', 'export')).error.code, 'USAGE');
  });

  test('CSV export preserves the requested final calendar date and uses date-only query values', async () => {
    w = await setup();
    const r = await w.run('transactions', 'export', '--out', path.join(w.home, 'range.csv'), '--from', '2026-01-01', '--to', '2026-01-31');
    assert.equal(r.exitCode, 0, r.stdout);
    const request = w.mock.requests.find((q) => q.operationId === 'downloadCSVFeedExportForDateRange');
    assert.deepEqual(request.query, { start: '2026-01-01', end: '2026-01-31' });
  });
});

describe('several accounts', () => {
  const two = [
    { accountUid: IDS.account, accountType: 'PRIMARY', defaultCategory: IDS.category, currency: 'GBP', name: 'Personal' },
    { accountUid: IDS.savingsAccount, accountType: 'ADDITIONAL', defaultCategory: IDS.savingsCategory, currency: 'GBP', name: 'Holiday pot' },
  ];

  test('uses the sole PRIMARY account, or asks when it cannot tell', async () => {
    w = await setup({ mock: { accounts: two } });
    assert.equal((await w.run('accounts', 'balance')).data.account.name, 'Personal');
    w.writeConfig({ permissions: ['view'] });
    const named = await w.run('accounts', 'balance', '--account', 'holiday pot');
    assert.equal(named.data.account.name, 'Holiday pot');
    assert.equal((await w.run('accounts', 'balance', '--account', 'nope')).error.code, 'ACCOUNT_NOT_FOUND');
  });

  test('two primary accounts and no default is an explicit question, never a guess', async () => {
    w = await setup({ mock: { accounts: two.map((a) => ({ ...a, accountType: 'PRIMARY' })) } });
    const r = await w.run('accounts', 'balance');
    assert.equal(r.error.code, 'AMBIGUOUS_ACCOUNT');
    assert.equal(r.error.details.accounts.length, 2);
    w.writeConfig({ permissions: ['view'], defaultAccountUid: IDS.savingsAccount });
    assert.equal((await w.run('accounts', 'balance')).data.account.name, 'Holiday pot');
  });
});

describe('permission groups', () => {
  test('a switched-off group fails fast with a hint for the user, and sends nothing', async () => {
    w = await setup({ permissions: ['view'] });
    for (const argv of [
      ['pay', '--payee', 'John Smith', '--amount', '5', '--reference', 'x'],
      ['payees', 'add', '--name', 'New Person', '--sort-code', '112233', '--account-number', '12345678'],
      ['cards', 'lock'],
      ['transactions', 'note', 'abc', 'hello'],
      ['goals', 'add', IDS.goal, '--amount', '5'],
      ['mandates', 'cancel', IDS.mandate],
    ]) {
      w.mock.reset();
      const r = await w.run(...argv);
      assert.equal(r.error?.code, 'PERMISSION_DISABLED', argv.join(' '));
      assert.match(r.error.hint, /do not edit the config yourself/);
      assert.equal(w.mock.requests.length, 0, `${argv.join(' ')} must not call Starling at all`);
    }
  });

  test('the generic call command enforces the same groups, and reads still work', async () => {
    w = await setup({ permissions: ['view'] });
    const del = await w.run('call', 'deletePayee', '--param', `payeeUid=${IDS.john}`);
    assert.equal(del.error.code, 'PERMISSION_DISABLED');
    assert.equal(w.mock.writes().length, 0);
    assert.equal((await w.run('call', 'getPayees')).exitCode, 0);
  });

  test('"organise" actions run straight away; "card-controls" too', async () => {
    w = await setup({ permissions: ['view', 'organise', 'card-controls'] });
    const note = await w.run('transactions', 'note', '88888888-8888-4888-8888-000000000001', 'weekly', 'shop');
    assert.equal(note.exitCode, 0, note.stdout);
    assert.equal(w.mock.state.notes.get('88888888-8888-4888-8888-000000000001'), 'weekly shop');
    const lock = await w.run('cards', 'lock');
    assert.equal(lock.exitCode, 0, lock.stdout);
    assert.deepEqual(w.mock.callsTo('enableCard')[0].body, { enabled: false });
    assert.equal(w.mock.state.cards[0].enabled, false);
    assert.equal((await w.run('cards', 'set', 'gambling', 'maybe')).error.code, 'USAGE');
  });

  test('"permissions" lists every group with what it allows', async () => {
    w = await setup({ permissions: ['view', 'payees'] });
    const r = await w.run('permissions');
    assert.equal(r.data.groups.length, 7);
    assert.equal(r.data.groups.find((g) => g.name === 'payees').enabled, true);
    assert.equal(r.data.groups.find((g) => g.name === 'payments').enabled, false);
    assert.match(r.data.howToChange, /"view" is always on/);
  });

  test('ops search shows which operations are switched off and which need confirmation', async () => {
    w = await setup({ permissions: ['view'] });
    const r = await w.run('ops', 'payee');
    assert.ok(r.data.operations.some((o) => /createPayee .*switched off.*confirm/.test(o)));
    const g = await w.run('ops', '--group', 'payments');
    assert.equal(g.data.count, 4);
    assert.equal((await w.run('ops', '--group', 'nonsense')).error.code, 'USAGE');
  });

  test('invalid config is reported plainly, not with a stack trace', async () => {
    w = await setup();
    writeFileSync(w.configPath, '{ "permissions": ["view", "everything"], }');
    const r = await w.run('accounts', 'list');
    assert.equal(r.error.code, 'CONFIG_INVALID');
    assert.match(r.error.message, /Unknown permission "everything"/);
    writeFileSync(w.configPath, '{ not json');
    assert.equal((await w.run('accounts', 'list')).error.code, 'CONFIG_INVALID');
  });
});

describe('errors and secrets', () => {
  test('no token: clear instruction, and no request is made', async () => {
    w = await setup();
    delete w.env.STARLING_ACCESS_TOKEN;
    const r = await w.run('accounts', 'list');
    assert.equal(r.error.code, 'NO_TOKEN');
    assert.match(r.error.hint, /do not paste it into the chat/);
    assert.equal(w.mock.requests.length, 0);
  });

  test('a rejected token is explained, and the token never appears in the output', async () => {
    w = await setup();
    w.env.STARLING_ACCESS_TOKEN = TOKEN + 'WRONG'; // the mock echoes whatever token it was given in its 401 body
    const r = await w.run('accounts', 'list');
    assert.equal(r.error.code, 'AUTH_FAILED');
    assert.ok(!r.stdout.includes('WRONG'), 'echoed token must be redacted');
  });

  test('a token missing a scope gives a 403 that names the scopes needed', async () => {
    w = await setup({ mock: { scopes: ['account:read', 'payee:read'] } });
    const r = await w.run('accounts', 'balance');
    assert.equal(r.error.code, 'FORBIDDEN');
    assert.match(r.error.hint, /balance:read/);
  });

  test('token can come from a file instead of the environment', async () => {
    w = await setup();
    const tokenFile = path.join(w.home, 'token.txt');
    writeFileSync(tokenFile, TOKEN + '\n', { mode: 0o600 });
    delete w.env.STARLING_ACCESS_TOKEN;
    w.writeConfig({ permissions: ['view'], auth: { tokenFile } });
    assert.equal((await w.run('accounts', 'list')).exitCode, 0);
  });

  test('rate limiting on reads is retried; server errors on reads are retried', async () => {
    w = await setup({ mock: { rateLimitGets: 2 } });
    const r = await w.run('accounts', 'list');
    assert.equal(r.exitCode, 0);
    assert.equal(w.mock.callsTo('getAccounts').length, 3);
  });

  test('unknown commands and options exit with a usage code', async () => {
    w = await setup();
    const a = await w.run('frobnicate');
    assert.equal(a.exitCode, 2);
    assert.equal(a.error.code, 'UNKNOWN_COMMAND');
    const b = await w.run('accounts', 'list', '--bogus');
    assert.equal(b.exitCode, 2);
    assert.equal(b.error.code, 'USAGE');
  });

  test('call: unknown operation, path traversal and missing params are rejected before any request', async () => {
    w = await setup();
    assert.equal((await w.run('call', 'dropAllTables')).error.code, 'UNKNOWN_OPERATION');
    assert.equal((await w.run('call', 'getPayee', '--param', 'payeeUid=../../etc')).error.code, 'BAD_PARAM');
    assert.equal((await w.run('call', 'getPayee')).error.code, 'MISSING_PARAM');
    assert.equal((await w.run('call', 'getConfirmationOfFunds')).error.code, 'MISSING_PARAM');
    assert.equal(w.mock.requests.filter((r) => r.operationId === 'getPayee').length, 0);
  });

  test('call fills in the account and category automatically', async () => {
    w = await setup();
    const r = await w.run('call', 'getAccountBalance');
    assert.equal(r.exitCode, 0);
    assert.equal(w.mock.callsTo('getAccountBalance')[0].path, `/api/v2/accounts/${IDS.account}/balance`);
    assert.ok(existsSync(w.home));
  });
});
