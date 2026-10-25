import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { IDS, PAYMENT_TOKEN, setup } from './helpers/harness.mjs';

let w;
afterEach(async () => {
  await w?.cleanup();
  w = null;
});

const payJohn = (amount = '25.00', reference = 'Dinner', ...extra) => ['pay', '--payee', 'John Smith', '--amount', amount, '--reference', reference, ...extra];
const paymentPuts = () => w.mock.callsTo('makeLocalPayment');
const planFile = (code) => path.join(w.home, 'state', 'plans', `${code}.json`);

async function payments(options = {}) {
  w = await setup({ signing: true, ...options });
  return w;
}

describe('preview, confirm, and what gets sent', () => {
  test('pay only previews: no payment is sent until confirm', async () => {
    await payments();
    const r = await w.run(...payJohn());
    assert.equal(r.exitCode, 0, r.stdout);
    assert.equal(r.json.status, 'needs_confirmation');
    assert.match(r.json.confirmCode, /^pay-[A-HJKMNP-Z2-9]{6}$/);
    assert.match(r.json.summary, /Pay £25\.00 to John Smith \(sort code 12-34-56, account \*\*\*\*5678\), reference "Dinner"/);
    assert.match(r.json.instructions, /Nothing has happened yet/);
    assert.equal(paymentPuts().length, 0);
    assert.equal(w.mock.writes().length, 0);
  });

  test('confirm sends exactly one correctly signed payment with the right body', async () => {
    await payments();
    const { json: preview } = await w.run(...payJohn('25.00', 'Dinner'));
    const r = await w.run('confirm', preview.confirmCode);
    assert.equal(r.exitCode, 0, r.stdout);
    assert.equal(r.data.paymentState, 'submitted');
    assert.ok(r.data.paymentOrderUid);
    assert.equal(r.data.earlyStatus[0].paymentStatusDetails.paymentStatus, 'PENDING');
    assert.match(r.data.reminder, /Starling app/);

    assert.equal(paymentPuts().length, 1);
    const put = paymentPuts()[0];
    assert.equal(put.signatureError, null, 'the mock verifies the signature independently of the client code');
    assert.equal(put.path, `/api/v2/payments/local/account/${IDS.account}/category/${IDS.category}`);
    assert.match(put.body.externalIdentifier, /^[0-9a-f-]{36}$/);
    assert.deepEqual({ ...put.body, externalIdentifier: 'x' }, { externalIdentifier: 'x', destinationPayeeAccountUid: IDS.johnAccount, reference: 'Dinner', amount: { currency: 'GBP', minorUnits: 2500 } });
    assert.match(put.headers.authorization, /^Bearer [^;]+;Signature keyid="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",algorithm="rsa-sha512",headers="\(request-target\) Date Digest"/);
  });

  test('pay works with an ECDSA signing key too', async () => {
    await payments({ keyType: 'ec' });
    const { json: preview } = await w.run(...payJohn());
    const r = await w.run('confirm', preview.confirmCode);
    assert.equal(r.exitCode, 0, r.stdout);
    assert.equal(paymentPuts()[0].signatureError, null);
    assert.match(paymentPuts()[0].headers.authorization, /algorithm="ecdsa-sha512"/);
  });

  test('confirming the same code twice never sends twice', async () => {
    await payments();
    const { json: preview } = await w.run(...payJohn());
    await w.run('confirm', preview.confirmCode);
    const again = await w.run('confirm', preview.confirmCode);
    assert.equal(again.exitCode, 0);
    assert.equal(again.data.alreadyExecuted, true);
    assert.equal(paymentPuts().length, 1);
  });

  test('cancel discards a prepared payment; its code stops working', async () => {
    await payments();
    const { json: preview } = await w.run(...payJohn());
    assert.equal((await w.run('cancel', preview.confirmCode)).exitCode, 0);
    assert.equal((await w.run('confirm', preview.confirmCode)).error.code, 'PLAN_NOT_FOUND');
    assert.equal(paymentPuts().length, 0);
  });

  test('payments status reports PENDING in plain words', async () => {
    await payments();
    const { json: preview } = await w.run(...payJohn());
    const { data } = await w.run('confirm', preview.confirmCode);
    const s = await w.run('payments', 'status', data.paymentOrderUid);
    assert.equal(s.data.state, 'PENDING');
    assert.match(s.data.explanation, /Starling app/);
    w.mock.state.paymentStatus = 'REJECTED';
    assert.equal((await w.run('payments', 'status', data.paymentOrderUid)).data.state, 'REJECTED');
  });

  test('the local log records what was sent, without bodies or secrets', async () => {
    await payments();
    const { json: preview } = await w.run(...payJohn());
    await w.run('confirm', preview.confirmCode);
    const log = await w.run('log');
    assert.equal(log.data.entries[0].operationId, 'makeLocalPayment');
    assert.equal(log.data.entries[0].amountMinor, 2500);
    assert.equal(log.data.entries[0].outcome, 'submitted');
    assert.ok(!('body' in log.data.entries[0]));
  });
});

test('payments have no local amount caps or recipient allowlist, but still need exact approvals', async () => {
  await payments();
  const first = await w.run(...payJohn('5000'));
  assert.equal(first.json.status, 'needs_confirmation');
  assert.equal((await w.run('confirm', first.json.confirmCode)).exitCode, 0);
  const second = await w.run('pay', '--payee', 'Jane Doe', '--amount', '1500', '--reference', 'Test');
  assert.equal(second.json.status, 'needs_confirmation');
  assert.equal(paymentPuts().length, 1);
  assert.equal((await w.run('confirm', second.json.confirmCode)).exitCode, 0);
  assert.equal(paymentPuts().length, 2);
});

describe('guards that stop a bad payment before it is previewed', () => {
  test('payments need a signing key, and the failure comes before the user is asked to approve', async () => {
    await payments({ signing: false, paymentToken: PAYMENT_TOKEN });
    const r = await w.run(...payJohn());
    assert.equal(r.error.code, 'SIGNING_NOT_CONFIGURED');
  });

  test('amounts are validated exactly', async () => {
    await payments();
    for (const bad of ['0', '-5', '1.234', 'ten', '1e3']) {
      assert.equal((await w.run(...payJohn(bad))).error.code, 'USAGE', bad);
    }
    assert.equal(w.mock.writes().length, 0);
  });

  test('reference rules: never truncated silently', async () => {
    await payments();
    const long = await w.run(...payJohn('5', 'A reference that is far too long'));
    assert.equal(long.error.code, 'REFERENCE_TOO_LONG');
    assert.match(long.error.message, /GBP payments allow at most 18/);
    assert.equal((await w.run(...payJohn('5', 'Dinner ✓'))).error.code, 'BAD_REFERENCE');
    assert.equal((await w.run('pay', '--payee', 'John Smith', '--amount', '5')).error.code, 'USAGE');
  });

  test('payee resolution: unknown, similar, ambiguous', async () => {
    await payments();
    const none = await w.run('pay', '--payee', 'Bob', '--amount', '5', '--reference', 'x');
    assert.equal(none.error.code, 'PAYEE_NOT_FOUND');
    const similar = await w.run('pay', '--payee', 'Joh', '--amount', '5', '--reference', 'x');
    assert.equal(similar.error.code, 'PAYEE_NOT_FOUND');
    assert.equal(similar.error.details.similar[0].payeeName, 'John Smith'); // suggested, never assumed
    const dup = await w.run('pay', '--payee', 'Alex Morgan', '--amount', '5', '--reference', 'x');
    assert.equal(dup.error.code, 'AMBIGUOUS_PAYEE');
    const byUid = await w.run('pay', '--payee', IDS.alex2, '--amount', '5', '--reference', 'x');
    assert.equal(byUid.json.status, 'needs_confirmation');
    assert.match(byUid.json.summary, /Alex Morgan .*sort code 22-22-22/);
    assert.equal(w.mock.writes().length, 0);
  });

  test('a payee with several accounts and no single default must be disambiguated', async () => {
    const twoAccounts = {
      payeeUid: '33333333-3333-4333-8333-777777777777', payeeName: 'Two Accounts Ltd', payeeType: 'BUSINESS',
      accounts: [
        { payeeAccountUid: '44444444-4444-4444-8444-888888888888', payeeChannelType: 'BANK_ACCOUNT', description: 'Current', defaultAccount: false, countryCode: 'GB', accountIdentifier: '10101010', bankIdentifier: '101010', bankIdentifierType: 'SORT_CODE' },
        { payeeAccountUid: '44444444-4444-4444-8444-999999999999', payeeChannelType: 'BANK_ACCOUNT', description: 'Savings', defaultAccount: false, countryCode: 'GB', accountIdentifier: '20202020', bankIdentifier: '202020', bankIdentifierType: 'SORT_CODE' },
      ],
    };
    await payments({ mock: { extraPayees: [twoAccounts] } });
    const r = await w.run('pay', '--payee', 'Two Accounts Ltd', '--amount', '5', '--reference', 'x');
    assert.equal(r.error.code, 'AMBIGUOUS_PAYEE_ACCOUNT');
    const ok = await w.run('pay', '--payee', 'Two Accounts Ltd', '--payee-account', '44444444-4444-4444-8444-999999999999', '--amount', '5', '--reference', 'x');
    assert.match(ok.json.summary, /account \*\*\*\*2020/);
  });

  test('the generic call command cannot bypass registered-recipient validation', async () => {
    await payments();
    const adHoc = await w.run('call', 'makeLocalPayment', '--body', JSON.stringify({ externalIdentifier: 'abc', reference: 'x', amount: { currency: 'GBP', minorUnits: 100 }, paymentRecipient: { payeeName: 'Mallory', payeeType: 'INDIVIDUAL', countryCode: 'GB', accountIdentifier: '99999999', bankIdentifier: '999999', bankIdentifierType: 'SORT_CODE' } }));
    assert.equal(adHoc.error.code, 'RECIPIENT_NOT_REGISTERED');
    const big = await w.run('call', 'makeLocalPayment', '--body', JSON.stringify({ externalIdentifier: 'abc', reference: 'x', amount: { currency: 'GBP', minorUnits: 600000 }, destinationPayeeAccountUid: IDS.johnAccount }));
    assert.equal(big.json.status, 'needs_confirmation');
    const fine = await w.run('call', 'makeLocalPayment', '--body', JSON.stringify({ externalIdentifier: 'abc', reference: 'x', amount: { currency: 'GBP', minorUnits: 600 }, destinationPayeeAccountUid: IDS.johnAccount }));
    assert.equal(fine.json.status, 'needs_confirmation'); // still needs the confirm step
    assert.equal(paymentPuts().length, 0);
  });

  test('currency must match the source account', async () => {
    await payments();
    const r = await w.run(...payJohn('5', 'x', '--currency', 'EUR'));
    assert.equal(r.error.code, 'CURRENCY_MISMATCH');
  });
});

describe('the confirmation step cannot be abused', () => {
  test('an expired code is refused', async () => {
    await payments();
    const { json } = await w.run(...payJohn());
    const plan = JSON.parse(readFileSync(planFile(json.confirmCode), 'utf8'));
    plan.expiresAt = new Date(Date.now() - 1000).toISOString();
    writeFileSync(planFile(json.confirmCode), JSON.stringify(plan));
    assert.equal((await w.run('confirm', json.confirmCode)).error.code, 'PLAN_EXPIRED');
    assert.equal(paymentPuts().length, 0);
  });

  test('editing the saved payment after it was shown is detected', async () => {
    await payments();
    const { json } = await w.run(...payJohn('5'));
    const plan = JSON.parse(readFileSync(planFile(json.confirmCode), 'utf8'));
    plan.request.body.amount.minorUnits = 5000;
    writeFileSync(planFile(json.confirmCode), JSON.stringify(plan));
    assert.equal((await w.run('confirm', json.confirmCode)).error.code, 'PLAN_TAMPERED');
    assert.equal(paymentPuts().length, 0);
  });

  test('malformed codes and unknown codes are rejected', async () => {
    await payments();
    assert.equal((await w.run('confirm', '../../etc/passwd')).error.code, 'BAD_CODE');
    assert.equal((await w.run('confirm', 'pay-ABCDEF')).error.code, 'PLAN_NOT_FOUND');
  });

  test('revoking the payment initiation scope after preview blocks confirmation', async () => {
    await payments();
    const { json } = await w.run(...payJohn());
    w.mock.state.tokens[PAYMENT_TOKEN].scopes = [];
    assert.equal((await w.run('confirm', json.confirmCode)).error.code, 'PAYMENT_SCOPE_MISSING');
    assert.equal(paymentPuts().length, 0);
  });

  test('switching between live and sandbox after the preview blocks the confirm', async () => {
    await payments();
    const { json } = await w.run(...payJohn());
    w.writeConfig({ environment: 'sandbox', signing: { keyUid: IDS.keyUid, privateKey: w.privateKey } });
    assert.equal((await w.run('confirm', json.confirmCode)).error.code, 'ENVIRONMENT_CHANGED');
  });

  test('terminal mode: chat approval is not enough', async () => {
    await payments({ config: { confirmation: { mode: 'terminal' } } });
    const { json } = await w.run(...payJohn());
    assert.match(json.nextStep, /must approve this in a terminal/);
    const r = await w.run('confirm', json.confirmCode);
    assert.equal(r.error.code, 'TERMINAL_APPROVAL_REQUIRED');
    assert.equal(paymentPuts().length, 0);
  });
});

describe('when things go wrong in flight', () => {
  test('lost response after the bank processed it: no blind resend, and a --retry reuses the same payment id', async () => {
    await payments();
    w.mock.state.failures.push({ operationId: 'makeLocalPayment', mode: 'drop-after', times: 1 });
    const { json } = await w.run(...payJohn());
    const lost = await w.run('confirm', json.confirmCode);
    assert.equal(lost.error.code, 'NETWORK_ERROR');
    assert.match(lost.error.hint, /Check before retrying/);
    assert.equal(w.mock.state.paymentsByExternalId.size, 1, 'the bank did process it');

    const blocked = await w.run('confirm', json.confirmCode);
    assert.equal(blocked.error.code, 'PLAN_UNCERTAIN');
    assert.equal(paymentPuts().length, 1, 'no second request without --retry');

    const retried = await w.run('confirm', json.confirmCode, '--retry');
    assert.equal(retried.exitCode, 0, retried.stdout);
    assert.equal(paymentPuts().length, 2);
    assert.equal(paymentPuts()[0].body.externalIdentifier, paymentPuts()[1].body.externalIdentifier);
    assert.equal(w.mock.state.paymentsByExternalId.size, 1, 'the bank saw one payment');
  });

  test('a rejected signature is explained, fails the plan for good without automatic resubmission', async () => {
    await payments({ config: { signing: { keyUid: '99999999-9999-4999-8999-999999999999' } } });
    w.writeConfig({ signing: { keyUid: '99999999-9999-4999-8999-999999999999', privateKey: w.privateKey } });
    const { json } = await w.run(...payJohn('40'));
    const r = await w.run('confirm', json.confirmCode);
    assert.equal(r.error.code, 'SIGNATURE_REJECTED');
    assert.match(r.error.hint, /signing\.keyUid/);
    assert.equal((await w.run('confirm', json.confirmCode)).error.code, 'PLAN_FAILED');
    assert.equal((await w.run(...payJohn('45'))).json.status, 'needs_confirmation', 'a failed payment is not counted');
  });

  test('a clock more than 5 seconds out makes Starling reject the signature, with a pointer to the clock', async () => {
    await payments({ mock: { clockSkewMs: 12000 } });
    const { json } = await w.run(...payJohn());
    const r = await w.run('confirm', json.confirmCode);
    assert.equal(r.error.code, 'SIGNATURE_REJECTED');
    assert.match(r.error.hint, /clock/);
    assert.match(r.error.message, /Date is/);
  });
});

describe('other confirm-gated actions', () => {
  test('an order 404 still queries its payments and reports unresolved approval when that list is empty', async () => {
    w = await setup();
    const r = await w.run('payments', 'status', '99999999-0000-4000-8000-000000000099');
    assert.equal(r.exitCode, 0, r.stdout);
    assert.equal(r.data.state, 'UNRESOLVED');
    assert.equal(r.data.lookups.order.httpStatus, 404);
    assert.equal(r.data.lookups.payments.httpStatus, 200);
    assert.deepEqual(r.data.payments, []);
    assert.match(r.data.explanation, /cannot determine/);
    assert.equal(w.mock.callsTo('getPaymentOrderPayments').length, 1);
    assert.equal(w.mock.writes().length, 0);
  });

  test('execution status is used even if the order itself is unavailable', async () => {
    w = await setup();
    const uid = '99999999-0000-4000-8000-000000000099';
    w.mock.state.paymentOrders.set(uid, { body: { amount: { currency: 'GBP', minorUnits: 1 }, reference: 'Test' } });
    w.mock.state.paymentStatus = 'REJECTED';
    w.mock.state.failures.push({ operationId: 'getPaymentOrder', mode: 'status', status: 404, times: 1 });
    const r = await w.run('payments', 'status', uid);
    assert.equal(r.data.state, 'REJECTED');
    assert.equal(r.data.order, null);
    assert.equal(r.data.payments.length, 1);
    assert.equal(r.data.lookups.order.httpStatus, 404);
    assert.equal(w.mock.writes().length, 0);
  });

  test('an execution lookup failure is unknown rather than falsely not-yet-processed', async () => {
    w = await setup();
    const uid = '99999999-0000-4000-8000-000000000099';
    w.mock.state.paymentOrders.set(uid, { body: { amount: { currency: 'GBP', minorUnits: 1 }, reference: 'Test' } });
    w.mock.state.failures.push({ operationId: 'getPaymentOrderPayments', mode: 'status', status: 503, times: 3 });
    const r = await w.run('payments', 'status', uid);
    assert.equal(r.data.state, 'UNKNOWN');
    assert.equal(r.data.payments, null);
    assert.equal(r.data.lookups.payments.errorCode, 'SERVER_ERROR');
    assert.equal(w.mock.writes().length, 0);
  });

  test('failure of both status endpoints retains an actionable API error', async () => {
    w = await setup({ mock: { scopes: ['account:read'] } });
    const r = await w.run('payments', 'status', '99999999-0000-4000-8000-000000000099');
    assert.equal(r.error.code, 'FORBIDDEN');
    assert.equal(w.mock.callsTo('getPaymentOrder').length, 1);
    assert.equal(w.mock.callsTo('getPaymentOrderPayments').length, 1);
  });

  test('payees add: preview with warnings, then confirm creates it; the new payee can be listed', async () => {
    w = await setup({ });
    const r = await w.run('payees', 'add', '--name', 'John Smith', '--sort-code', '12-34-56', '--account-number', '12345678');
    assert.equal(r.json.status, 'needs_confirmation');
    assert.match(r.json.confirmCode, /^payee-/);
    assert.match(r.json.summary, /sort code 12-34-56, account number 12345678/);
    assert.equal(r.json.details.warnings.length, 2, 'existing name and existing account details are both flagged');
    assert.equal(w.mock.writes().length, 0);

    const done = await w.run('confirm', r.json.confirmCode);
    assert.equal(done.exitCode, 0, done.stdout);
    const put = w.mock.callsTo('createPayee')[0];
    assert.deepEqual(put.body, { payeeName: 'John Smith', payeeType: 'INDIVIDUAL', accounts: [{ description: 'Main account', defaultAccount: true, countryCode: 'GB', accountIdentifier: '12345678', bankIdentifier: '123456', bankIdentifierType: 'SORT_CODE' }] });
    assert.equal(put.headers.digest === undefined, true, 'payee creation is not a signed operation');
  });

  test('payees add validates sort code and account number', async () => {
    w = await setup({ });
    assert.equal((await w.run('payees', 'add', '--name', 'X', '--sort-code', '1234', '--account-number', '12345678')).error.code, 'USAGE');
    assert.equal((await w.run('payees', 'add', '--name', 'X', '--sort-code', '123456', '--account-number', '1234')).error.code, 'USAGE');
    assert.equal(w.mock.writes().length, 0);
  });

  test('payees delete previews with the payee name; confirm deletes', async () => {
    w = await setup({ });
    const { json } = await w.run('payees', 'delete', 'Jane Doe');
    assert.match(json.summary, /Delete payee "Jane Doe"/);
    assert.equal(w.mock.callsTo('deletePayee').length, 0);
    await w.run('confirm', json.confirmCode);
    assert.equal(w.mock.callsTo('deletePayee')[0].path, `/api/v2/payees/${IDS.jane}`);
  });

  test('cancelling a standing order is a signed DELETE with no body (digest "X")', async () => {
    await payments();
    const uid = '99999999-0000-4000-8000-000000000001';
    const { json } = await w.run('payments', 'cancel-standing-order', uid);
    assert.match(json.confirmCode, /^pay-/);
    const done = await w.run('confirm', json.confirmCode);
    assert.equal(done.exitCode, 0, done.stdout);
    const del = w.mock.callsTo('cancelStandingOrder')[0];
    assert.equal(del.signatureError, null);
    assert.equal(del.headers.digest, 'X');
  });

  test('mandates cancel needs account-settings and a confirm', async () => {
    w = await setup({ signing: true });
    const { json } = await w.run('mandates', 'cancel', IDS.mandate);
    assert.match(json.summary, /Gym Ltd/);
    assert.match(json.confirmCode, /^acct-/);
    assert.equal(w.mock.callsTo('cancelMandate').length, 0);
    await w.run('confirm', json.confirmCode);
    assert.equal(w.mock.callsTo('cancelMandate').length, 1);
  });
});
