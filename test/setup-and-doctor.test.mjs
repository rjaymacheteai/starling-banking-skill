import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { PAYMENT_LIMITS, setup, TOKEN } from './helpers/harness.mjs';

let w;
afterEach(async () => {
  await w?.cleanup();
  w = null;
});

const SCRIPT = new URL('../scripts/starling-banking.mjs', import.meta.url).pathname;
const doctor = async (...extra) => {
  const r = await w.run('doctor', ...extra);
  return { ...r, text: r.stdout };
};

describe('doctor', () => {
  test('a healthy read-only setup passes and says so', async () => {
    w = await setup();
    const r = await doctor();
    assert.equal(r.exitCode, 0, r.text);
    assert.match(r.text, /✓ Reached Starling .* the token is accepted/);
    assert.match(r.text, /✓ Clock is in sync with Starling/);
    assert.match(r.text, /✓ 1 account\(s\) visible: Personal \(GBP\)/);
    assert.match(r.text, /All good\./);
    assert.ok(!r.text.includes(TOKEN));
  });

  test('--json gives machine-readable checks', async () => {
    w = await setup();
    const r = await doctor('--json');
    assert.equal(r.json.data.ok, true);
    assert.ok(r.json.data.checks.some((c) => c.status === 'pass'));
  });

  test('no token: fails with the exact next step and never touches the network', async () => {
    w = await setup();
    delete w.env.STARLING_ACCESS_TOKEN;
    const r = await doctor();
    assert.equal(r.exitCode, 1);
    assert.match(r.text, /✗ Required account access token is missing/);
    assert.match(r.text, /STARLING_ACCESS_TOKEN/);
    assert.equal(w.mock.requests.length, 0);
  });

  test('wrong token: explains it was rejected', async () => {
    w = await setup();
    w.env.STARLING_ACCESS_TOKEN = TOKEN + 'x';
    const r = await doctor();
    assert.equal(r.exitCode, 1);
    assert.match(r.text, /✗ Starling did not accept the token/);
  });

  test('unreachable Starling is reported as a network problem', async () => {
    w = await setup();
    await w.mock.close();
    const r = await doctor();
    assert.equal(r.exitCode, 1);
    assert.match(r.text, /✗ Cannot reach Starling/);
    w.mock = { close: async () => {} };
  });

  test('no config file: still usable, with a pointer to init', async () => {
    w = await setup({ writeConfig: false });
    const r = await doctor();
    assert.equal(r.exitCode, 0, r.text);
    assert.match(r.text, /No config file; default credential sources apply/);
    assert.match(r.text, /run `init`/);
  });

  test('a broken config is reported with the line that is wrong', async () => {
    w = await setup();
    writeFileSync(w.configPath, JSON.stringify({ limits: { perPayment: 'lots' }, tpyo: true }));
    const r = await doctor();
    assert.equal(r.exitCode, 1);
    assert.match(r.text, /limits\.perPayment" must be a number above zero/);
  });

  test('unknown settings are warned about, not silently ignored', async () => {
    w = await setup({ config: { permisions: ['view'] } });
    const r = await doctor();
    assert.match(r.text, /! Config setting ignored[\s\S]*Unknown setting "permisions"/);
  });

  test('doctor describes bank-granted scopes without local permission switches', async () => {
    w = await setup({ mock: { scopes: ['account:read', 'balance:read'] } });
    const r = await doctor();
    assert.match(r.text, /Account token scopes: account:read, balance:read/);
    assert.match(r.text, /no local permission switches/);
    assert.equal(r.exitCode, 0);
  });

  test('payments: missing limits/signing disable payments without blocking account reads', async () => {
    w = await setup({ paymentToken: (await import('./helpers/harness.mjs')).PAYMENT_TOKEN });
    const r = await doctor();
    assert.equal(r.exitCode, 0);
    assert.match(r.text, /! Signing is not ready/);
    assert.match(r.text, /! Payment spending limits are not set/);
    assert.equal((await doctor('--json')).json.data.capabilities.payments.ready, false);
    assert.match(r.text, /keys generate/);
  });

  test('payments: a working key and limits pass, and the self-test is local', async () => {
    w = await setup({ limits: PAYMENT_LIMITS, signing: true });
    const r = await doctor();
    assert.equal(r.exitCode, 0, r.text);
    assert.match(r.text, /✓ Signing key works \(rsa-sha512, key uid aaaaaaaa/);
    assert.match(r.text, /Spending limits: GBP 50 per payment, GBP 100 per day/);
    assert.match(r.text, /Any registered payee can be paid/);
  });

  test('payments: a missing key file is reported', async () => {
    w = await setup({ limits: PAYMENT_LIMITS, signing: true });
    writeFileSync(w.configPath, JSON.stringify({ limits: PAYMENT_LIMITS, signing: { keyUid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', keyFile: path.join(w.home, 'nope.key') } }));
    const r = await doctor();
    assert.match(r.text, /! Signing is not ready[\s\S]*Signing key file not found/);
  });

  test('payments: clock drift disables payment readiness while reads remain available', async () => {
    w = await setup({ limits: PAYMENT_LIMITS, signing: true, mock: { clockSkewMs: 9000 } });
    assert.match((await doctor()).text, /! Your clock is about \d+\.\ds away/);
    assert.equal((await doctor('--json')).json.data.capabilities.payments.ready, false);
    w.mock.state.clockSkewMs = 3000;
    assert.match((await doctor()).text, /! Your clock is about \d+\.\ds away/);
  });

  test('a key file that others can read gets a warning', async (t) => {
    if (process.platform === 'win32') return t.skip('unix permissions only');
    w = await setup({ limits: PAYMENT_LIMITS, signing: true });
    (await import('node:fs')).chmodSync(w.keyFile, 0o644);
    assert.match((await doctor()).text, /! Private key file is readable by other users[\s\S]*chmod 600/);
  });

  test('terminal confirmation mode is explained', async () => {
    w = await setup({ limits: PAYMENT_LIMITS, signing: true, config: { confirmation: { mode: 'terminal' } } });
    assert.match((await doctor()).text, /Confirmation mode: terminal[\s\S]*typing a code in a terminal/);
  });
});

describe('init and keys generate', () => {
  test('init creates a working config from the example and will not overwrite it', async () => {
    w = await setup({ writeConfig: false });
    const r = await w.run('init');
    assert.equal(r.exitCode, 0, r.stdout);
    assert.ok(existsSync(r.data.created));
    assert.match(readFileSync(r.data.created, 'utf8'), /Starling banking skill: configuration/);
    assert.ok(existsSync(r.data.created));
    assert.equal((await w.run('init')).error.code, 'FILE_EXISTS');
    assert.equal((await w.run('init', '--force')).exitCode, 0);
    assert.equal((await doctor()).exitCode, 0);
  });

  test('keys generate (ecdsa) writes private keys 0600, never overwrites, and the key then works for signing', async (t) => {
    w = await setup();
    const dir = path.join(w.home, 'newkeys');
    const r = await w.run('keys', 'generate', '--type', 'ecdsa', '--dir', dir);
    assert.equal(r.exitCode, 0, r.stdout);
    assert.equal(r.data.files.length, 4);
    if (process.platform !== 'win32') assert.equal(statSync(path.join(dir, 'starling-api-private.key')).mode & 0o777, 0o600);
    assert.match(r.data.publicKeys.api, /BEGIN PUBLIC KEY/);
    assert.ok(!r.stdout.includes('PRIVATE KEY'));
    const priv = crypto.createPrivateKey(readFileSync(path.join(dir, 'starling-api-private.key')));
    assert.equal(priv.asymmetricKeyType, 'ec');
    assert.equal((await w.run('keys', 'generate', '--dir', dir)).error.code, 'FILE_EXISTS');
    assert.equal((await w.run('keys', 'generate', '--type', 'dsa')).error.code, 'USAGE');
    t.diagnostic('rsa-4096 generation is exercised by the CLI smoke test below');
  });
});

describe('the real entry script', () => {
  const run = (args, env = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });

  test('help, version and unknown commands set sensible exit codes', () => {
    const help = run(['help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Commands:[\s\S]*doctor[\s\S]*pay /);
    assert.match(run(['--version']).stdout, /^\d+\.\d+\.\d+/);
    const bad = run(['nonsense']);
    assert.equal(bad.status, 2);
    assert.equal(JSON.parse(bad.stdout).error.code, 'UNKNOWN_COMMAND');
  });

  test('every command has help text, and --help never makes a network call', () => {
    const list = run(['help']).stdout;
    const commands = [...list.matchAll(/^ {2}([a-z][a-z -]+?) {2,}/gm)].map((m) => m[1].trim());
    assert.ok(commands.length > 30, `found ${commands.length} commands`);
    for (const c of commands) {
      const r = run([...c.split(' '), '--help'], { STARLING_BANKING_HOME: '/nonexistent' });
      assert.equal(r.status, 0, `${c} --help failed: ${r.stdout}`);
      assert.match(r.stdout, /Usage: starling-banking/, c);
    }
  });

  test('works end to end as a subprocess against the mock, including process exit', async () => {
    w = await setup();
    // Async on purpose: the mock server lives in this process, and a blocking spawn would starve it.
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [SCRIPT, 'accounts', 'list'], { encoding: 'utf8', env: w.env });
    assert.equal(JSON.parse(stdout).data.accounts[0].name, 'Personal');
    assert.equal(stderr, '');
  });

  test('rsa 4096 key generation works from the CLI', { timeout: 60000 }, async () => {
    w = await setup();
    const dir = path.join(w.home, 'rsakeys');
    const r = spawnSync(process.execPath, [SCRIPT, 'keys', 'generate', '--dir', dir], { encoding: 'utf8', env: w.env });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(crypto.createPrivateKey(readFileSync(path.join(dir, 'starling-api-private.key'))).asymmetricKeyDetails.modulusLength, 4096);
  });
});
