import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import { setup, TOKEN, PAYMENT_TOKEN } from './helpers/harness.mjs';
import { loadSigner, selfTest } from '../scripts/lib/signing.mjs';
import { loadConfig } from '../scripts/lib/config.mjs';

let w;
afterEach(async () => { await w?.cleanup(); w = null; });
const SCRIPT = new URL('../scripts/starling-banking.mjs', import.meta.url).pathname;

test('doctor passes account-only setup, shows optional payment setup and never exposes credentials', async () => {
  w = await setup();
  const r = await w.run('doctor', '--json');
  assert.equal(r.data.ok, true);
  assert.equal(r.data.capabilities.account.ready, true);
  assert.equal(r.data.capabilities.payments.ready, false);
  assert.ok(!r.stdout.includes(TOKEN));
});
test('missing config and missing account token are distinct actionable failures without network', async () => {
  w = await setup({ writeConfig: false });
  assert.match((await w.run('doctor')).stdout, /No local config.json found/);
  w.setTokens(null);
  assert.match((await w.run('doctor')).stdout, /Required account access token is missing/);
  assert.equal(w.mock.requests.length, 0);
});
test('invalid account token and network failure are explained without leaking secrets', async () => {
  w = await setup();
  w.setTokens(TOKEN + 'wrong');
  assert.match((await w.run('doctor')).stdout, /Starling did not accept/);
  w.setTokens(TOKEN);
  await w.mock.close(); w.mock = { close: async () => {} };
  assert.match((await w.run('doctor')).stdout, /Cannot reach Starling/);
});
test('malformed secret config does not echo JSON parser snippets or secret values', async () => {
  w = await setup();
  writeFileSync(w.configPath, '{ "auth": {"accountToken":"sensitiveOpaqueValue99", invalid');
  const r = await w.run('doctor');
  assert.equal(r.exitCode, 1);
  assert.ok(!r.stdout.includes('sensitiveOpaqueValue99'));
  assert.match(r.stdout, /Could not parse/);
});
test('optional signing absence disables payments but not account access', async () => {
  w = await setup({ paymentToken: PAYMENT_TOKEN });
  const r = await w.run('doctor', '--json');
  assert.equal(r.data.ok, true);
  assert.equal(r.data.capabilities.payments.ready, false);
});
test('matching tokens, valid UID and embedded private key enable payment readiness without limits', async () => {
  w = await setup({ signing: true });
  assert.equal((await w.run('doctor', '--json')).data.capabilities.payments.ready, true);
  assert.ok(!('limits' in loadConfig(w.env).config));
});
test('clock drift and malformed private key leave account access usable', async () => {
  w = await setup({ signing: true, mock: { clockSkewMs: 9000 } });
  assert.equal((await w.run('doctor', '--json')).data.capabilities.payments.ready, false);
  w.writeConfig({ signing: { keyUid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', privateKey: 'badPemSecret99' } });
  const r = await w.run('doctor');
  assert.match(r.stdout, /Signing is not ready/);
  assert.ok(!r.stdout.includes('badPemSecret99'));
});
test('doctor warns when the secret config is readable by other users', async (t) => {
  if (process.platform === 'win32') return t.skip();
  w = await setup(); chmodSync(w.configPath, 0o644);
  assert.match((await w.run('doctor')).stdout, /Secret config file is readable/);
});
test('init creates exactly one owner-only config and refuses to overwrite it', async () => {
  w = await setup({ writeConfig: false });
  const r = await w.run('init');
  assert.equal(r.exitCode, 0);
  assert.equal(readFileSync(w.configPath, 'utf8').includes('accountToken'), true);
  if (process.platform !== 'win32') assert.equal(statSync(w.configPath).mode & 0o777, 0o600);
  assert.equal((await w.run('init')).error.code, 'FILE_EXISTS');
});
for (const type of ['ecdsa', 'rsa']) test(`${type}: generation stores private key in config, shows only public key and does not create rotation files`, { timeout: 60000 }, async () => {
  w = await setup();
  const r = await w.run('keys', 'generate', '--type', type);
  assert.equal(r.exitCode, 0, r.stdout);
  assert.deepEqual(Object.keys(r.data.publicKeys), ['api']);
  assert.ok(!r.stdout.includes('PRIVATE KEY'));
  const config = loadConfig(w.env).config;
  assert.ok(config.signing.privateKey.includes('PRIVATE KEY'));
  const pub = crypto.createPublicKey(config.signing.privateKey).export({ type: 'spki', format: 'pem' });
  assert.equal(pub, r.data.publicKeys.api);
  assert.equal((await w.run('keys', 'public')).data.publicKeys.api, pub);
  assert.equal((await w.run('keys', 'generate')).error.code, 'FILE_EXISTS');
  assert.equal(existsSync(w.home + '/starling-rotation-private.key'), false);
  config.signing.keyUid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  assert.equal(selfTest(loadSigner(config)), true);
  assert.equal((await w.run('accounts', 'list')).exitCode, 0, 'account token survives key generation');
});
test('entry-script help and version work before config exists; banking subprocess uses only config', async () => {
  w = await setup();
  assert.equal(spawnSync(process.execPath, [SCRIPT, 'help'], { encoding: 'utf8', env: { PATH: process.env.PATH } }).status, 0);
  const { stdout } = await promisify(execFile)(process.execPath, [SCRIPT, 'accounts', 'list'], { encoding: 'utf8', env: w.env });
  assert.equal(JSON.parse(stdout).data.accounts[0].name, 'Personal');
});
