#!/usr/bin/env node
// Developer fixtures: one secret config per simulated holder; no token/key files.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../scripts/lib/cli.mjs';
import { DEFAULTS, loadConfig, saveConfig } from '../scripts/lib/config.mjs';
import { assertSandboxConfig, assertSandboxToken } from './lib/sandbox-guard.mjs';
import { sandboxPaths } from './lib/sandbox-paths.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const profile = process.argv[3] ?? 'default';
const { home, configFile } = sandboxPaths(root, profile);
const env = { PATH: process.env.PATH, STARLING_BANKING_HOME: home, STARLING_BANKING_CONFIG: configFile };
async function command(args) { const r = await main(args, env); const j = JSON.parse(r.stdout); if (r.exitCode) throw new Error([j.error?.code, j.error?.message, j.error?.hint].filter(Boolean).join(': ')); return j; }
async function run() {
  const mode = process.argv[2];
  if (mode === 'setup' && !existsSync(configFile)) {
    const config = structuredClone(DEFAULTS); config.environment = 'sandbox';
    // Customers in the same simulator app can share one registered API signing key.
    const first = sandboxPaths(root, 'individual').configFile;
    if (profile !== 'individual' && existsSync(first)) config.signing = loadConfig({ ...env, STARLING_BANKING_CONFIG: first }).config.signing;
    saveConfig(configFile, config);
  }
  const { config, found } = loadConfig(env);
  if (!found) throw new Error('Run sandbox setup to create the isolated config.');
  assertSandboxConfig(config, env, configFile);
  if (mode === 'setup') {
    if (!config.signing.privateKey) await command(['keys', 'generate']);
    console.log(`Sandbox config: ${configFile}`);
    console.log((await command(['keys', 'public'])).data.publicKeys.api);
    return;
  }
  if (mode === 'token') {
    const token = readFileSync(0, 'utf8').trim();
    if (!token || /\s/.test(token)) throw new Error('Supply one simulator token via hidden input/stdin.');
    // Simulator OAuth scopes allow this explicit fixture assignment; production PATs stay separate.
    config.auth = { accountToken: token, paymentToken: token };
    saveConfig(configFile, config); return;
  }
  if (mode === 'key') { config.signing.keyUid = process.env.STARLING_SANDBOX_KEY_UID; saveConfig(configFile, config); return; }
  if (mode !== 'check') throw new Error('Use setup, token, key or check.');
  const liveFile = path.join(root, '.local', 'config.json');
  const auth = existsSync(liveFile) ? JSON.parse(readFileSync(liveFile, 'utf8')).auth ?? {} : {};
  assertSandboxToken(config.auth.accountToken ?? '', [auth.accountToken, auth.paymentToken].filter(Boolean));
  const report = await command(['doctor', '--json']);
  if (!report.data.capabilities.account.ready) throw new Error('Sandbox account access is not ready.');
  console.log(`Sandbox ${profile}: account authentication passed. No bank writes.`);
}
run().catch((e) => { console.error(e.message); process.exitCode = 1; });
