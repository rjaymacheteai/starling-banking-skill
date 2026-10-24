#!/usr/bin/env node
// Sandbox-only setup and connection check. No model calls and no bank writes.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../scripts/lib/cli.mjs';
import { loadConfig } from '../scripts/lib/config.mjs';
import { baseUrlFor } from '../scripts/lib/client.mjs';
import { assertSandboxConfig, assertSandboxToken } from './lib/sandbox-guard.mjs';
import { sandboxPaths } from './lib/sandbox-paths.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const profile = process.argv[3] ?? 'default';
const { home, configFile, tokenFile, keyDir } = sandboxPaths(root, profile);
const env = { ...process.env, STARLING_BANKING_HOME: home, STARLING_BANKING_CONFIG: configFile };
delete env.STARLING_BANKING_TEST_BASE_URL;
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });

async function command(args) {
  const r = await main(args, env);
  let json;
  try { json = JSON.parse(r.stdout); } catch { throw new Error('CLI did not return JSON.'); }
  if (r.exitCode !== 0 || json.status === 'error') throw new Error([json.error?.code, json.error?.message, json.error?.hint].filter(Boolean).join(': '));
  return json;
}

async function run() {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  if (process.argv[2] === 'setup') {
    if (!existsSync(configFile)) save(configFile, {
      environment: 'sandbox', permissions: ['view'], auth: { tokenFile },
      confirmation: { mode: 'agent', expiresMinutes: 10 },
      limits: { currency: 'GBP', perPayment: 1, perDay: 10 },
    });
    const dir = keyDir;
    if (!existsSync(path.join(dir, 'starling-api-private.key'))) await command(['keys', 'generate', '--dir', dir]);
    console.log(`Sandbox config: ${configFile}`);
    console.log(`Sandbox API public key: ${path.join(dir, 'starling-api-public.key')}`);
    console.log(`Sandbox rotation public key: ${path.join(dir, 'starling-rotation-public.key')}`);
    return;
  }
  const { config, found } = loadConfig(env);
  if (!found) throw new Error('Run npm run setup:sandbox to create the isolated sandbox config.');
  assertSandboxConfig(config, env, tokenFile);
  if (process.argv[2] === 'key') {
    const uid = process.env.STARLING_SANDBOX_KEY_UID;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid ?? '')) throw new Error('The API Key UID must be a UUID.');
    config.signing = { keyUid: uid, keyFile: path.join(keyDir, 'starling-api-private.key'), algorithm: 'auto' };
    save(configFile, config);
    console.log('Sandbox signing-key settings saved.');
    return;
  }
  if (process.argv[2] !== 'check') throw new Error('Use setup, key or check.');
  if (!existsSync(tokenFile) || !readFileSync(tokenFile, 'utf8').trim()) throw new Error('No sandbox token saved. Run npm run setup:sandbox in your terminal.');
  const token = readFileSync(tokenFile, 'utf8').trim();
  const liveFiles = ['access-token', 'tokens/read-only.token', 'tokens/payees.token', 'tokens/payments.token'];
  const liveTokens = liveFiles.map((file) => path.join(root, '.local', file)).filter(existsSync).map((file) => readFileSync(file, 'utf8'));
  assertSandboxToken(token, liveTokens);
  const identity = (await command(['call', 'getTokenIdentity'])).data.result;
  const accounts = (await command(['accounts', 'list'])).data.accounts;
  if (!Array.isArray(identity?.scopes) || identity.authenticated === false) throw new Error('Sandbox identity response was not a valid authenticated identity.');
  if (!Array.isArray(accounts) || !accounts.length) throw new Error('No sandbox accounts are visible; create a test customer/account in the simulator first.');
  const report = {
    checkedAt: new Date().toISOString(), customer: profile, environment: 'sandbox', apiHost: baseUrlFor(config, env),
    authenticated: true, accountCount: accounts.length, bankWrites: false,
    scopes: identity?.scopes ?? [], signingConfigured: !!config.signing.keyUid,
  };
  save(path.join(home, 'preflight.json'), report);
  console.log(`Sandbox ${profile}: authentication passed; ${accounts.length} account(s), ${report.scopes.length} scopes. No bank writes.`);
  console.log(report.signingConfigured ? 'Signing is configured; server acceptance still needs a signed test.' : 'Signed payment tests need the sandbox public keys uploaded and API Key UID configured.');
  console.log(`Report: ${path.join(home, 'preflight.json')}`);
}

run().catch((e) => { console.error(e.message); process.exitCode = 1; });
