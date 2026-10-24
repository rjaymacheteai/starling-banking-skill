import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setup, IDS } from './helpers/harness.mjs';

test('generic sensitive changes preview exact request values before any bank write', async () => {
  const w = await setup({ permissions: ['view', 'account-settings'], signing: true });
  try {
    const r = await w.run('call', 'updateEmail', '--body', JSON.stringify({ email: 'new-address@example.test' }));
    assert.equal(r.exitCode, 0, r.stdout);
    assert.equal(r.json.status, 'needs_confirmation');
    assert.match(r.json.summary, /new-address@example\.test/);
    assert.equal(w.mock.writes().length, 0);
  } finally { await w.cleanup(); }
});

test('generic calls cannot create or update unsupported standing orders', async () => {
  const w = await setup({ permissions: ['view', 'payments'] });
  try {
    for (const operation of ['createStandingOrder', 'updateStandingOrder']) {
      const r = await w.run('call', operation, '--param', `accountUid=${IDS.account}`, '--param', `categoryUid=${IDS.category}`, '--param', 'paymentOrderUid=99999999-0000-4000-8000-000000000099', '--body', '{}');
      assert.equal(r.error.code, 'UNSUPPORTED_OPERATION', r.stdout);
    }
    assert.equal(w.mock.writes().length, 0);
  } finally { await w.cleanup(); }
});
