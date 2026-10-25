import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { setup, IDS, TOKEN, PAYMENT_TOKEN } from './helpers/harness.mjs';
import { DEFAULTS, validateConfig } from '../scripts/lib/config.mjs';

let w;
afterEach(async () => { await w?.cleanup(); w = null; });
const pay = ['pay', '--payee', 'John Smith', '--amount', '1', '--reference', 'Routing'];
const options = { signing: true, };
const bearer = (q) => q.headers.authorization.replace(/^Bearer /, '').split(';')[0];

for (const [account, payment] of [[false, false], [true, false], [false, true], [true, true]]) {
  test(`token matrix account=${account}, payment=${payment}`, async () => {
    w = await setup({ ...options, paymentToken: payment ? PAYMENT_TOKEN : '' });
    if (!account) w.setTokens(null);
    const d = await w.run('doctor', '--json');
    assert.equal(d.data.ok, account);
    assert.equal(d.data.capabilities.account.ready, account);
    assert.equal(d.data.capabilities.payments.ready, account && payment);
    w.mock.reset();
    assert.equal((await w.run('accounts', 'balance')).exitCode, account ? 0 : 1);
    const p = await w.run(...pay);
    if (!account) {
      assert.equal(p.error.code, 'NO_TOKEN');
      assert.equal(w.mock.requests.length, 0, 'payment-only token must not substitute for the required account token');
    } else if (!payment) {
      assert.equal(p.error.code, 'NO_PAYMENT_TOKEN');
      assert.match(p.error.hint, /auth.paymentToken/);
      assert.equal(w.mock.callsTo('makeLocalPayment').length, 0);
    } else {
      assert.equal(p.json.status, 'needs_confirmation');
      assert.equal((await w.run('confirm', p.json.confirmCode)).exitCode, 0);
      assert.equal(w.mock.callsTo('makeLocalPayment').length, 1);
      assert.equal(bearer(w.mock.callsTo('makeLocalPayment')[0]), PAYMENT_TOKEN);
      assert.ok(w.mock.requests.filter((q) => q.operationId !== 'getTokenIdentity' && q.operationId !== 'makeLocalPayment').every((q) => bearer(q) === TOKEN));
    }
  });
}

test('payee creation, update, immediate writes and payment reads always use the account token', async () => {
  w = await setup(options);
  const created = await w.run('payees', 'add', '--display-name', 'Test Person', '--first-name', 'Test', '--last-name', 'Person', '--sort-code', '040004', '--account-number', '87654321');
  assert.equal((await w.run('confirm', created.json.confirmCode)).exitCode, 0);
  const update = await w.run('payees', 'update', IDS.john, '--first-name', 'Jonathan', '--last-name', 'Smith');
  assert.equal((await w.run('confirm', update.json.confirmCode)).exitCode, 0);
  assert.equal((await w.run('transactions', 'note', '88888888-8888-4888-8888-000000000006', 'Test')).exitCode, 0);
  assert.equal((await w.run('cards', 'lock')).exitCode, 0);
  assert.equal((await w.run('payments', 'status', '00000000-0000-4000-8000-000000000000')).exitCode, 0);
  assert.ok(w.mock.requests.every((q) => bearer(q) === TOKEN));
});

test('generic payment operation and repeat confirmation route correctly without duplicate submissions', async () => {
  w = await setup(options);
  const p = await w.run('call', 'makeLocalPayment', '--body', JSON.stringify({ externalIdentifier: 'routing-test', destinationPayeeAccountUid: IDS.johnAccount, reference: 'Routing', amount: { currency: 'GBP', minorUnits: 100 } }));
  assert.equal(p.json.status, 'needs_confirmation');
  assert.equal((await w.run('confirm', p.json.confirmCode)).exitCode, 0);
  assert.equal((await w.run('confirm', p.json.confirmCode)).data.alreadyExecuted, true);
  assert.equal(w.mock.callsTo('makeLocalPayment').length, 1);
  assert.equal(bearer(w.mock.callsTo('makeLocalPayment')[0]), PAYMENT_TOKEN);
});

test('removing payment token between preview and confirmation blocks submission but keeps the plan usable', async () => {
  w = await setup(options);
  const p = await w.run(...pay);
  w.setTokens(TOKEN, null);
  assert.equal((await w.run('confirm', p.json.confirmCode)).error.code, 'NO_PAYMENT_TOKEN');
  assert.equal(w.mock.callsTo('makeLocalPayment').length, 0);
  w.setTokens(TOKEN, PAYMENT_TOKEN);
  assert.equal((await w.run('confirm', p.json.confirmCode)).exitCode, 0);
});

for (const [name, credential, expected] of [
  ['invalid', null, 'PAYMENT_AUTH_FAILED'],
  ['wrong holder', { scopes: ['pay-local:create'], accountHolderUid: IDS.jane }, 'PAYMENT_TOKEN_MISMATCH'],
  ['missing holder', { scopes: ['pay-local:create'] }, 'PAYMENT_IDENTITY_UNVERIFIED'],
  ['missing initiation scope', { scopes: ['balance:read'], accountHolderUid: IDS.account }, 'PAYMENT_SCOPE_MISSING'],
]) {
  test(`payment token ${name} never falls back and does not block account access`, async () => {
    w = await setup(options);
    if (credential) w.mock.state.tokens[PAYMENT_TOKEN] = credential;
    else delete w.mock.state.tokens[PAYMENT_TOKEN];
    const d = await w.run('doctor', '--json');
    assert.equal(d.data.ok, true);
    assert.equal(d.data.capabilities.payments.ready, false);
    const p = await w.run(...pay);
    assert.equal(p.error.code, expected, p.stdout);
    assert.equal((await w.run('accounts', 'balance')).exitCode, 0);
    assert.equal(w.mock.callsTo('makeLocalPayment').length, 0);
    assert.ok(!p.stdout.includes(PAYMENT_TOKEN));
  });
}

test('credentials come only from the single config, never environment or token files', async () => {
  w = await setup(options);
  w.setTokens(null, null);
  w.env.STARLING_ACCESS_TOKEN = TOKEN;
  w.env.STARLING_PAYMENT_ACCESS_TOKEN = PAYMENT_TOKEN;
  assert.equal((await w.run('accounts', 'balance')).error.code, 'NO_TOKEN');
  assert.equal(w.mock.requests.length, 0);
  w.setTokens(TOKEN, PAYMENT_TOKEN);
  w.env.STARLING_ACCESS_TOKEN = 'wrong';
  assert.equal((await w.run('doctor', '--json')).data.capabilities.payments.ready, true);
});

test('legacy credential sources and removed filters are rejected with migration guidance', () => {
  for (const raw of [{ auth: { tokenFile: '/private/token' } }, { auth: { account: { tokenEnv: 'TOKEN' } } }, { limits: {} }, { allowedPayees: [] }]) assert.ok(validateConfig(raw).errors.length);
});

test('rejected required account token never uses the optional token as fallback', async () => {
  w = await setup(options);
  w.setTokens('wrongAccountSecret99');
  assert.equal((await w.run(...pay)).error.code, 'AUTH_FAILED');
  assert.equal(w.mock.callsTo('makeLocalPayment').length, 0);
  assert.ok(w.mock.requests.every((q) => bearer(q) !== PAYMENT_TOKEN));
});

test('private API key without its registered UID cannot prepare signed actions; reads still work', async () => {
  w = await setup(options);
  w.writeConfig({ signing: { keyUid: null, privateKey: w.privateKey }, });
  assert.equal((await w.run('accounts', 'balance')).exitCode, 0);
  assert.equal((await w.run(...pay)).error.code, 'SIGNING_NOT_CONFIGURED');
  assert.equal((await w.run('call', 'updateEmail', '--body', '{"email":"test@example.test"}')).error.code, 'SIGNING_NOT_CONFIGURED');
  assert.equal(w.mock.writes().length, 0);
});
