import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { CliError } from './errors.mjs';
import { parseJsonc } from './jsonc.mjs';
import { configPath } from './paths.mjs';
import { registerSecret } from './redact.mjs';

export const ALGORITHMS = ['auto', 'rsa-sha256', 'rsa-sha512', 'ecdsa-sha256', 'ecdsa-sha512'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DEFAULTS = Object.freeze({
  environment: 'live',
  auth: { accountToken: null, paymentToken: null },
  signing: { keyUid: null, privateKey: null, algorithm: 'auto' },
  defaultAccountUid: null,
  confirmation: { mode: 'agent', expiresMinutes: 10 },
});

function registerCredentials(raw) {
  for (const value of [raw?.auth?.accountToken, raw?.auth?.paymentToken, raw?.signing?.privateKey]) {
    if (typeof value === 'string' && value.trim()) {
      registerSecret(value.trim());
      if (value.includes('PRIVATE KEY')) registerSecret(value.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, ''));
    }
  }
}
export function validateConfig(raw) {
  registerCredentials(raw);
  const errors = [], warnings = [], config = structuredClone(DEFAULTS);
  const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (!object(raw)) return { config, errors: ['The config must be a JSON object.'], warnings };
  for (const section of ['', 'auth', 'signing', 'confirmation']) {
    const value = section ? raw[section] : raw;
    if (value === undefined) continue;
    if (!object(value)) { errors.push(`"${section}" must be an object.`); continue; }
    const defaults = section ? DEFAULTS[section] : DEFAULTS;
    for (const key of Object.keys(value)) if (!(key in defaults)) errors.push(`Unsupported setting "${section ? section + '.' : ''}${key}". Use the single-file structure in config.json.example; token sources, limits and recipient filters are no longer supported.`);
  }
  if (raw.environment !== undefined) {
    if (!['live', 'sandbox'].includes(raw.environment)) errors.push('"environment" must be "live" or "sandbox".');
    else config.environment = raw.environment;
  }
  for (const [section, keys] of [['auth', ['accountToken', 'paymentToken']], ['signing', ['privateKey']]]) {
    for (const key of keys) {
      const v = raw[section]?.[key];
      if (v === undefined) continue;
      if (v === null || typeof v === 'string') config[section][key] = typeof v === 'string' ? v.trim() || null : null;
      else errors.push(`"${section}.${key}" must be text or null.`);
    }
  }
  if (raw.signing?.keyUid !== undefined) {
    const v = raw.signing.keyUid;
    if (v === null || (typeof v === 'string' && UUID.test(v))) config.signing.keyUid = v;
    else errors.push('"signing.keyUid" must be the API public key UID from Starling (a UUID) or null.');
  }
  if (raw.signing?.algorithm !== undefined) {
    if (ALGORITHMS.includes(raw.signing.algorithm)) config.signing.algorithm = raw.signing.algorithm;
    else errors.push('"signing.algorithm" is unsupported; normally use "auto".');
  }
  if (raw.defaultAccountUid !== undefined) {
    if (raw.defaultAccountUid === null || (typeof raw.defaultAccountUid === 'string' && UUID.test(raw.defaultAccountUid))) config.defaultAccountUid = raw.defaultAccountUid;
    else errors.push('"defaultAccountUid" must be an account UID or null.');
  }
  if (raw.confirmation?.mode !== undefined) {
    if (['agent', 'terminal'].includes(raw.confirmation.mode)) config.confirmation.mode = raw.confirmation.mode;
    else errors.push('"confirmation.mode" must be "agent" or "terminal".');
  }
  if (raw.confirmation?.expiresMinutes !== undefined) {
    const v = raw.confirmation.expiresMinutes;
    if (Number.isInteger(v) && v >= 1 && v <= 60) config.confirmation.expiresMinutes = v;
    else errors.push('"confirmation.expiresMinutes" must be an integer from 1 to 60.');
  }
  return { config, errors, warnings };
}

export function loadConfig(env = process.env) {
  const file = configPath(env), found = existsSync(file);
  let raw = {};
  if (found) {
    try { raw = parseJsonc(readFileSync(file, 'utf8')); }
    catch { throw new CliError('CONFIG_INVALID', `Could not parse ${file}.`, { hint: 'Fix the JSON locally using config.json.example. Do not paste this secret file into chat.' }); }
  }
  const { config, errors, warnings } = validateConfig(raw);
  if (errors.length) throw new CliError('CONFIG_INVALID', `Problems in ${file}:\n- ${errors.join('\n- ')}`, { hint: 'Update the local file to config.json.example; never send its contents to the agent.' });
  return { config, file, found, warnings };
}

export function saveConfig(file, config) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(file, 0o600);
}

export function loadToken(config, _env = process.env, role = 'account') {
  const payment = role === 'payments';
  const token = config.auth[payment ? 'paymentToken' : 'accountToken'];
  if (!token) throw new CliError(payment ? 'NO_PAYMENT_TOKEN' : 'NO_TOKEN', payment ? 'Optional payment access token is not configured.' : 'Required Starling account access token is missing.', {
    hint: payment ? 'Add auth.paymentToken to your local config.json only if you want payments. Account access still works without it. Never paste tokens into chat.' : 'Run `init` if needed, then fill auth.accountToken in your local config.json. The payment token is optional. Never paste tokens into chat.',
  });
  registerSecret(token);
  return { token, source: payment ? 'config.json auth.paymentToken' : 'config.json auth.accountToken' };
}

export function fileModeWarning(file) {
  if (process.platform === 'win32') return null;
  try { const mode = statSync(file).mode & 0o777; if (mode & 0o077) return `${file} is readable by other users (mode ${mode.toString(8)}). Run: chmod 600 ${file}`; } catch {}
  return null;
}
