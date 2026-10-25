#!/usr/bin/env node
// Interactive live integration tests. Credentials and recipient details stay local.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../scripts/lib/cli.mjs';
import { loadConfig } from '../scripts/lib/config.mjs';
import { NAME_FIELDS } from '../scripts/lib/payee-names.mjs';
import { PlanStore } from '../scripts/lib/state.mjs';
import { recoverLiveState } from './lib/live-state.mjs';
import { repeatedPaymentStatus } from './lib/live-payment-status.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const home = path.join(root, '.local');
const mode = process.argv[2];
const isPayment = ['payment', 'payment-pending', 'payment-reject'].includes(mode);
const previewOnly = process.argv[3] === '--preview';
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function run() {
  if (!['register', 'update', 'payment', 'payment-pending', 'payment-reject'].includes(mode)) throw new Error('Use register, update, payment, payment-pending or payment-reject.');
  if (!previewOnly && !process.stdin.isTTY) throw new Error('Run this in your own interactive terminal; approval requires typing the confirmation code.');
  const env = {
    ...process.env,
    STARLING_BANKING_HOME: home,
    STARLING_BANKING_CONFIG: path.join(home, 'config.json'),
  };
  delete env.STARLING_BANKING_TEST_BASE_URL;
  const { config, found } = loadConfig(env);
  if (!found || config.environment !== 'live' || config.confirmation.mode !== 'terminal') {
    throw new Error('A live config with terminal confirmation is required.');
  }
  async function command(args) {
    const result = await main(args, env);
    let json;
    try { json = JSON.parse(result.stdout); } catch { throw new Error('CLI did not return JSON.'); }
    if (result.exitCode !== 0 || json.status === 'error') {
      const e = new Error([json.error?.code, json.error?.message, json.error?.hint].filter(Boolean).join(': ') || 'CLI failed.');
      e.code = json.error?.code;
      throw e;
    }
    return json;
  }

  let args;
  if (mode === 'register' || mode === 'update') {
    const recipient = read(path.join(home, 'test-payee.json'));
    const label = recipient.displayName || recipient.name;
    const names = [];
    for (const [flag, field] of Object.entries(NAME_FIELDS)) {
      if (recipient[field] == null || recipient[field] === '') continue;
      if (typeof recipient[field] !== 'string') throw new Error(`${field} must be text.`);
      names.push(`--${flag}`, recipient[field]);
    }
    if (mode === 'register' && (typeof label !== 'string' || !label.trim() ||
        typeof recipient.sortCode !== 'string' || typeof recipient.accountNumber !== 'string' ||
        !/^\d{6}$/.test(String(recipient.sortCode ?? '').replace(/[\s-]/g, '')) ||
        !/^\d{8}$/.test(String(recipient.accountNumber ?? '').replace(/\s/g, '')))) {
      throw new Error('Fill in displayName (or name), sortCode (6 digits) and accountNumber (8 digits) in .local/test-payee.json. Keep numbers in quotation marks.');
    }
    if (mode === 'register') {
      args = ['payees', 'add', '--name', label, '--sort-code', recipient.sortCode,
        '--account-number', recipient.accountNumber, '--type', recipient.type ?? 'individual', ...names];
    } else {
      if (!names.length) throw new Error('Fill in the recipient name fields in .local/test-payee.json before the update test.');
      const registration = read(path.join(home, 'live-register.json'));
      const uid = registration.outcome?.result?.payeeUid;
      if (registration.status !== 'submitted' || !uid) throw new Error('No registered test payee was found.');
      args = ['payees', 'update', uid, ...(label ? ['--display-name', label] : []), ...names];
    }
  } else {
    const registration = read(path.join(home, 'live-register.json'));
    const uid = registration.outcome?.result?.payeeUid;
    if (registration.status !== 'submitted' || !uid) throw new Error('Complete the registration test first; no registered test payee was found.');
    // The recipient is exactly the payee created in the preceding registration test.
    const reference = mode === 'payment-reject' ? 'API Reject' : mode === 'payment-pending' ? 'API Pending' : 'API Test';
    args = ['pay', '--payee', uid, '--amount', '0.01', '--reference', reference];
  }

  const stateFile = path.join(home, `live-${mode}.json`);
  const inputHash = hash(args);
  const plans = new PlanStore(env);
  let state = await recoverLiveState(existsSync(stateFile) ? read(stateFile) : null, inputHash, {
    loadPlan: (code) => plans.load(code),
    cancel: (code) => command(['cancel', code]),
  });
  const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });

  if (!state) {
    const preview = await command(args);
    if (preview.status !== 'needs_confirmation' || !preview.confirmCode) throw new Error('The CLI did not produce a confirmation preview.');
    for (const warning of preview.details?.warnings ?? []) console.log(`Warning: ${warning}`);
    state = { status: 'prepared', inputHash, confirmCode: preview.confirmCode, createdAt: new Date().toISOString(), expiresAt: preview.expiresAt };
    save();
  }
  if (previewOnly) {
    save();
    console.log(`Test action status: ${state.status}. Local report: ${stateFile}`);
    return;
  }
  // Reusing the same code lets the CLI enforce expiry, one-time execution and uncertain outcomes.
  // No --retry: an uncertain bank write must be investigated before another attempt.
  try {
    const confirmed = await command(['confirm', state.confirmCode]);
    state.status = confirmed.data.actionState ?? 'submitted';
    state.outcome = confirmed.data;
    delete state.error;
    const repeated = isPayment ? await repeatedPaymentStatus(confirmed.data, command) : null;
    if (repeated?.bankState) state.lastVerifiedBankState = repeated.bankState;
    save();
    if (repeated) console.log(repeated.message);
    else if (state.status === 'awaiting_bank_approval') {
      console.log(confirmed.data.reminder);
      if (mode === 'payment-pending') console.log('For this test, leave the Starling app request unapproved until its status has been checked.');
      if (mode === 'payment-reject') console.log('For this test, open the new Starling request with reference API Reject and choose Reject/Decline while it is visible.');
    } else console.log(isPayment ? '£0.01 payment submitted; check its status before treating it as paid.' : `Payee ${mode === 'register' ? 'registration' : 'name update'} submitted.`);
    console.log(`Local report: ${stateFile}`);
  } catch (e) {
    try { state.status = plans.load(state.confirmCode).status; }
    catch { state.status = e.code === 'PLAN_EXPIRED' ? 'expired' : 'unavailable'; }
    state.error = { code: e.code, message: e.message };
    save();
    throw e;
  }
}

run().catch((e) => { console.error(e.message); process.exitCode = 1; });
