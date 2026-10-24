import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setup, IDS } from './helpers/harness.mjs';

test('payee history sends a calendar date rather than a timestamp', async () => {
  const w = await setup();
  try {
    const r = await w.run('payees', 'history', IDS.john, '--from', '2026-01-01');
    assert.equal(r.exitCode, 0, r.stdout);
    assert.deepEqual(r.data.payments, []);
    assert.equal(w.mock.callsTo('listPaymentsForPayeeAccount')[0].query.since, '2026-01-01');
    assert.equal(w.mock.writes().length, 0);
  } finally { await w.cleanup(); }
});
