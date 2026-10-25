import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { setup, IDS } from './helpers/harness.mjs';

let w;
afterEach(async () => { await w?.cleanup(); w = null; });
const account = ['--sort-code', '12-34-56', '--account-number', '12345678'];
const world = async () => { w = await setup({ }); };

test('personal payee stores the supplied name separately from the display label, after approval', async () => {
  await world();
  const preview = await w.run('payees', 'add', '--display-name', 'Sister', '--first-name', 'Alice', '--middle-name', 'Mary', '--last-name', 'Taylor', ...account);
  assert.equal(preview.json.status, 'needs_confirmation');
  assert.equal(preview.json.details.suppliedRecipientName, 'Alice Mary Taylor');
  assert.equal(preview.json.details.bankNameCheck, 'not_reported_by_api');
  assert.match(preview.json.summary, /display name "Sister"/);
  assert.match(preview.json.summary, /Alice Mary Taylor/);
  assert.equal(w.mock.writes().length, 0);
  const done = await w.run('confirm', preview.json.confirmCode);
  assert.equal(done.exitCode, 0, done.stdout);
  const body = w.mock.callsTo('createPayee')[0].body;
  assert.equal(body.payeeName, 'Sister');
  assert.equal(body.firstName, 'Alice');
  assert.equal(body.middleName, 'Mary');
  assert.equal(body.lastName, 'Taylor');
  const listed = await w.run('payees', 'get', done.data.result.payeeUid);
  assert.equal(listed.data.payeeName, 'Sister');
  assert.equal(listed.data.firstName, 'Alice');
  assert.equal(listed.data.lastName, 'Taylor');
  assert.equal(listed.data.bankNameCheck, 'not_reported_by_api');
});

test('label-only registration remains supported and never guesses name parts', async () => {
  await world();
  const preview = await w.run('payees', 'add', '--name', 'Alex Taylor', ...account);
  assert.equal(preview.json.details.suppliedRecipientName, null);
  assert.match(preview.json.summary, /Recipient name not supplied/);
  await w.run('confirm', preview.json.confirmCode);
  const body = w.mock.callsTo('createPayee')[0].body;
  assert.equal(body.firstName, undefined);
  assert.equal(body.lastName, undefined);
});

test('a supplied recipient name defaults the display label, including a name without a surname', async () => {
  await world();
  const full = await w.run('payees', 'add', '--first-name', 'Alex', '--last-name', 'Taylor', ...account);
  assert.equal(full.json.details.payeeName, 'Alex Taylor');
  const single = await w.run('payees', 'add', '--first-name', 'Alex', ...account);
  assert.equal(single.json.details.payeeName, 'Alex');
  assert.equal(single.json.details.lastName, undefined);
});

test('business recipient name is separate from its display label and is optional', async () => {
  await world();
  const full = await w.run('payees', 'add', '--type', 'business', '--display-name', 'Plumber', '--business-name', 'Taylor Plumbing Ltd', ...account);
  await w.run('confirm', full.json.confirmCode);
  assert.equal(w.mock.callsTo('createPayee')[0].body.businessName, 'Taylor Plumbing Ltd');
  assert.equal(w.mock.callsTo('createPayee')[0].body.payeeName, 'Plumber');
  const label = await w.run('payees', 'add', '--type', 'business', '--name', 'Plumber 2', ...account);
  await w.run('confirm', label.json.confirmCode);
  assert.equal(w.mock.callsTo('createPayee')[1].body.businessName, undefined);
});

test('conflicting or invalid name options fail before any bank request', async () => {
  await world();
  for (const flags of [
    ['--name', 'A', '--display-name', 'B'],
    ['--first-name', '   '],
    ['--name', 'X', '--business-name', 'Business'],
    ['--type', 'business', '--name', 'X', '--first-name', 'Alice'],
    ['--name', 'X'.repeat(256)],
  ]) {
    assert.equal((await w.run('payees', 'add', ...flags, ...account)).error.code, 'USAGE');
  }
  assert.equal(w.mock.requests.length, 0);
});

test('renaming a label preserves the recipient name and other existing personal fields', async () => {
  await world();
  const payee = w.mock.state.payees.find((p) => p.payeeUid === IDS.jane);
  Object.assign(payee, { firstName: 'Jane', middleName: 'Mary', lastName: 'Doe', phoneNumber: '+447700900123', dateOfBirth: '1990-01-01' });
  const preview = await w.run('payees', 'rename', IDS.jane, '--name', 'Rent');
  assert.equal(w.mock.writes().length, 0);
  await w.run('confirm', preview.json.confirmCode);
  const body = w.mock.callsTo('updatePayee')[0].body;
  assert.equal(body.payeeName, 'Rent');
  assert.equal(body.firstName, 'Jane');
  assert.equal(body.middleName, 'Mary');
  assert.equal(body.lastName, 'Doe');
  assert.equal(body.phoneNumber, '+447700900123');
  assert.equal(body.dateOfBirth, '1990-01-01');
  assert.deepEqual(body.accounts, [{ description: 'Main', defaultAccount: true, countryCode: 'GB', accountIdentifier: '87654321', bankIdentifier: '654321', bankIdentifierType: 'SORT_CODE' }]);
  assert.equal(payee.accounts.length, 1);
});

test('updating recipient names preserves the display label and requires confirmation', async () => {
  await world();
  const payee = w.mock.state.payees.find((p) => p.payeeUid === IDS.jane);
  payee.lastName = 'Doe';
  const preview = await w.run('payees', 'update', IDS.jane, '--first-name', 'Jane');
  assert.equal(preview.json.status, 'needs_confirmation');
  assert.equal(w.mock.writes().length, 0);
  const done = await w.run('confirm', preview.json.confirmCode);
  assert.equal(done.exitCode, 0, done.stdout);
  const body = w.mock.callsTo('updatePayee')[0].body;
  assert.equal(body.payeeName, 'Jane Doe');
  assert.equal(body.firstName, 'Jane');
  assert.equal(body.lastName, 'Doe');
  assert.equal(body.accounts.length, 1);
});

test('a name-only update preserves every bank account and secondary reference without response-only fields', async () => {
  await world();
  const payee = w.mock.state.payees.find((p) => p.payeeUid === IDS.jane);
  payee.accounts.push({ ...payee.accounts[0], payeeAccountUid: '11111111-2222-4333-8444-555555555555', accountIdentifier: '12345679', description: 'Second', defaultAccount: false, secondaryIdentifier: 'Customer 123' });
  const preview = await w.run('payees', 'update', IDS.jane, '--last-name', 'Doe');
  const confirmed = await w.run('confirm', preview.json.confirmCode);
  assert.equal(confirmed.exitCode, 0, confirmed.stdout);
  const accounts = w.mock.callsTo('updatePayee')[0].body.accounts;
  assert.equal(accounts.length, 2);
  assert.equal(accounts[1].secondaryIdentifier, 'Customer 123');
  assert.equal(accounts[1].defaultAccount, false);
  assert.equal(accounts[0].payeeAccountUid, undefined);
  assert.equal(accounts[0].payeeChannelType, undefined);
  assert.equal(payee.accounts.length, 2);
});

test('a payee with incomplete/non-bank account details cannot be silently rewritten', async () => {
  await world();
  const payee = w.mock.state.payees.find((p) => p.payeeUid === IDS.jane);
  payee.accounts.push({ payeeAccountUid: '11111111-2222-4333-8444-555555555555', payeeChannelType: 'SETTLE_UP', description: 'Other' });
  const update = await w.run('payees', 'update', IDS.jane, '--first-name', 'Jane');
  assert.equal(update.error.code, 'PAYEE_UPDATE_UNSUPPORTED');
  assert.equal(w.mock.writes().length, 0);
});

test('mock rejects the same missing-accounts payload rejected by the live bank', async () => {
  await world();
  const preview = await w.run('call', 'updatePayee', '--param', `payeeUid=${IDS.jane}`, '--body', JSON.stringify({ payeeName: 'Jane', payeeType: 'INDIVIDUAL' }));
  const confirmed = await w.run('confirm', preview.json.confirmCode);
  assert.equal(confirmed.error.code, 'BAD_REQUEST');
  assert.match(confirmed.error.message, /ACCOUNTS_size/);
});

test('recipient name update is denied by bank token scopes after a confirmed preview', async () => {
  w = await setup({ mock: { scopes: ['account:read', 'payee:read'] } });
  const preview = await w.run('payees', 'update', IDS.jane, '--first-name', 'Jane');
  assert.equal(preview.json.status, 'needs_confirmation');
  assert.equal(w.mock.writes().length, 0);
  assert.equal((await w.run('confirm', preview.json.confirmCode)).error.code, 'FORBIDDEN');
});

test('payment preview displays both the label and supplied recipient name without claiming a name match', async () => {
  w = await setup({ signing: true });
  Object.assign(w.mock.state.payees.find((p) => p.payeeUid === IDS.jane), { firstName: 'Jane', lastName: 'Registered' });
  const preview = await w.run('pay', '--payee', IDS.jane, '--amount', '0.01', '--reference', 'Test');
  assert.match(preview.json.summary, /Jane Doe/);
  assert.match(preview.json.summary, /supplied recipient name: Jane Registered/);
  assert.equal(preview.json.details.bankNameCheck, 'not_reported_by_api');
  assert.equal(w.mock.writes().length, 0);
});
