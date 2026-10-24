import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repeatedPaymentStatus } from '../tools/lib/live-payment-status.mjs';

test('a repeated payment confirmation queries its current status instead of repeating stale app approval', async () => {
  const calls = [];
  const result = await repeatedPaymentStatus({ alreadyExecuted: true, actionState: 'awaiting_bank_approval', result: { paymentOrderUid: 'order-1' } }, async (args) => {
    calls.push(args); return { data: { state: 'ACCEPTED' } };
  });
  assert.deepEqual(calls, [['payments', 'status', 'order-1']]);
  assert.equal(result.bankState, 'ACCEPTED');
  assert.match(result.message, /No new payment request was submitted/);
  assert.match(result.message, /ACCEPTED/);
});

test('unavailable status never causes a new payment request', async () => {
  const calls = [];
  const result = await repeatedPaymentStatus({ alreadyExecuted: true, paymentOrderUid: 'order-1' }, async (args) => {
    calls.push(args); throw Object.assign(new Error('offline'), { code: 'NETWORK_ERROR' });
  });
  assert.deepEqual(calls, [['payments', 'status', 'order-1']]);
  assert.equal(result.errorCode, 'NETWORK_ERROR');
  assert.match(result.message, /No new payment request/);
});

test('new submissions and responses without an order UID do not invent a status query', async () => {
  const command = () => assert.fail('No bank query should be made');
  assert.equal(await repeatedPaymentStatus({ paymentOrderUid: 'order-1' }, command), null);
  const result = await repeatedPaymentStatus({ alreadyExecuted: true }, command);
  assert.equal(result.bankState, undefined);
});
