import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { recoverLiveState } from '../tools/lib/live-state.mjs';
import { PlanStore } from '../scripts/lib/state.mjs';
import { setup, IDS } from './helpers/harness.mjs';

let w;
afterEach(async () => { await w?.cleanup(); w = null; });

test('a rejected update gets a fresh preview without cancelling the failed plan or repeating the bank write', async () => {
  w = await setup({ permissions: ['view', 'payees'] });
  w.mock.state.failures.push({ operationId: 'updatePayee', mode: 'status', status: 400, times: 1 });
  const preview = await w.run('payees', 'update', IDS.jane, '--first-name', 'Jane');
  const failed = await w.run('confirm', preview.json.confirmCode);
  assert.equal(failed.error.code, 'BAD_REQUEST');
  const plans = new PlanStore(w.env);
  const recovered = await recoverLiveState({ status: 'prepared', confirmCode: preview.json.confirmCode, inputHash: 'a' }, 'a', {
    loadPlan: (code) => plans.load(code),
    cancel: () => assert.fail('Failed plans must not be cancelled'),
    now: Date.now() + 3600000,
  });
  assert.equal(recovered, null);
  assert.equal(plans.load(preview.json.confirmCode).status, 'failed');
  const fresh = await w.run('payees', 'update', IDS.jane, '--first-name', 'Jane');
  assert.equal(fresh.json.status, 'needs_confirmation');
  assert.notEqual(fresh.json.confirmCode, preview.json.confirmCode);
  assert.equal(w.mock.callsTo('updatePayee').length, 1);
});

test('a lost update response blocks recovery even when the saved helper state is prepared and expired', async () => {
  w = await setup({ permissions: ['view', 'payees'] });
  w.mock.state.failures.push({ operationId: 'updatePayee', mode: 'drop-after', times: 1 });
  const preview = await w.run('payees', 'update', IDS.jane, '--first-name', 'Jane');
  const uncertain = await w.run('confirm', preview.json.confirmCode);
  assert.equal(uncertain.error.code, 'NETWORK_ERROR');
  const plans = new PlanStore(w.env);
  await assert.rejects(recoverLiveState({ status: 'prepared', confirmCode: preview.json.confirmCode, inputHash: 'a' }, 'changed', {
    loadPlan: (code) => plans.load(code),
    cancel: () => assert.fail('An uncertain write must not be cancelled or recreated'),
    now: Date.now() + 3600000,
  }), { code: 'PLAN_UNCERTAIN' });
  assert.equal(w.mock.callsTo('updatePayee').length, 1);
});

test('only a genuinely prepared plan is cancelled when its input changes or expires', async () => {
  for (const inputHash of ['changed', 'a']) {
    const cancelled = [];
    const result = await recoverLiveState({ confirmCode: 'payee-ABC123', inputHash: 'a' }, inputHash, {
      loadPlan: () => ({ status: 'prepared', expiresAt: new Date(0).toISOString() }),
      cancel: async (code) => cancelled.push(code),
    });
    assert.equal(result, null);
    assert.deepEqual(cancelled, ['payee-ABC123']);
  }
});

test('completed plan outcome is recovered without creating a new action', async () => {
  const result = await recoverLiveState({ confirmCode: 'payee-ABC123', inputHash: 'a', status: 'prepared' }, 'a', {
    loadPlan: () => ({ status: 'done', outcome: { httpStatus: 200 } }),
    cancel: () => assert.fail('Completed plans must not be cancelled'),
  });
  assert.equal(result.status, 'submitted');
  assert.equal(result.outcome.httpStatus, 200);
});

test('an expired plan removed by the CLI can be replaced; unexplained missing plans cannot', async () => {
  const missing = () => { throw Object.assign(new Error('Missing'), { code: 'PLAN_NOT_FOUND' }); };
  const deps = { loadPlan: missing, cancel: () => assert.fail('Missing plans cannot be cancelled') };
  assert.equal(await recoverLiveState({ confirmCode: 'payee-ABC123', error: { code: 'PLAN_EXPIRED' } }, 'a', deps), null);
  await assert.rejects(recoverLiveState({ confirmCode: 'payee-ABC123' }, 'a', deps), { code: 'PLAN_NOT_FOUND' });
});
