import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { bankApproval } from '../scripts/lib/bank-approval.mjs';
import { PlanStore } from '../scripts/lib/state.mjs';
import { recoverLiveState } from '../tools/lib/live-state.mjs';
import { setup, IDS } from './helpers/harness.mjs';

let w;
afterEach(async () => { await w?.cleanup(); w = null; });
const consent = { approvalType: 'IN_APP_APPROVAL', consentUid: '99999999-1111-4222-8333-444444444444' };

test('direct payee and nested payment consents are recognised without claiming completion', () => {
  for (const result of [consent, { paymentOrderUid: 'example', consentInformation: consent }]) {
    const approval = bankApproval(result);
    assert.equal(approval.actionState, 'awaiting_bank_approval');
    assert.equal(approval.bankApproval.consentUid, consent.consentUid);
    assert.match(approval.reminder, /does not confirm the action completed/);
  }
  for (const result of [null, { success: true }, { approvalType: 'IN_APP_APPROVAL' }]) {
    assert.deepEqual(bankApproval(result), {});
  }
});

test('HTTP 200 with consent leaves the payee unchanged, reports app approval and never resends on confirm', async () => {
  w = await setup({ mock: { payeeUpdateRequiresApproval: true } });
  const preview = await w.run('payees', 'update', IDS.jane, '--first-name', 'Different');
  const result = await w.run('confirm', preview.json.confirmCode);
  assert.equal(result.exitCode, 0, result.stdout);
  assert.equal(result.data.httpStatus, 200);
  assert.equal(result.data.actionState, 'awaiting_bank_approval');
  assert.equal(w.mock.state.payees.find((p) => p.payeeUid === IDS.jane).firstName, undefined);
  const again = await w.run('confirm', preview.json.confirmCode);
  assert.equal(again.data.alreadyExecuted, true);
  assert.equal(again.data.actionState, 'awaiting_bank_approval');
  assert.equal(w.mock.callsTo('updatePayee').length, 1);
});

test('previously saved consent responses are classified correctly without a new bank write', async () => {
  w = await setup({ });
  const preview = await w.run('payees', 'update', IDS.jane, '--first-name', 'Different');
  const plans = new PlanStore(w.env);
  const plan = plans.load(preview.json.confirmCode);
  plan.status = 'done';
  plan.outcome = { result: consent, httpStatus: 200 };
  plans.save(plan);
  const result = await w.run('confirm', plan.code);
  assert.equal(result.data.actionState, 'awaiting_bank_approval');
  assert.equal(w.mock.writes().length, 0);
});

test('helper recovery reflects pending bank approval and removes stale local approval errors', async () => {
  const result = await recoverLiveState({ confirmCode: 'payee-ABC123', inputHash: 'same', status: 'submitted', error: { code: 'NOT_APPROVED' } }, 'same', {
    loadPlan: () => ({ status: 'done', outcome: { result: consent, httpStatus: 200 } }),
    cancel: () => assert.fail('A bank consent must not be cancelled or recreated'),
  });
  assert.equal(result.status, 'awaiting_bank_approval');
  assert.equal(result.error, undefined);
});
