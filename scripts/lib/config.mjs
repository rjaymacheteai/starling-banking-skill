import { existsSync, readFileSync, statSync } from 'node:fs';
import { CliError } from './errors.mjs';
import { parseJsonc } from './jsonc.mjs';
import { configPath, expandHome } from './paths.mjs';
import { registerSecret } from './redact.mjs';

export const ALGORITHMS = ['auto', 'rsa-sha256', 'rsa-sha512', 'ecdsa-sha256', 'ecdsa-sha512'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DEFAULTS = Object.freeze({
  environment: 'live',
  auth: { account: { tokenEnv: 'STARLING_ACCESS_TOKEN', tokenFile: null }, payments: { tokenEnv: 'STARLING_PAYMENT_ACCESS_TOKEN', tokenFile: null } },
  signing: { keyUid: null, keyFile: null, algorithm: 'auto' },
  defaultAccountUid: null,
  limits: { currency: 'GBP', perPayment: null, perDay: null },
  allowedPayees: [],
  confirmation: { mode: 'agent', expiresMinutes: 10 },
});

const SECTION_KEYS = {
  '': Object.keys(DEFAULTS),
  auth: [...Object.keys(DEFAULTS.auth), 'tokenEnv', 'tokenFile'],
  'auth.account': Object.keys(DEFAULTS.auth.account),
  'auth.payments': Object.keys(DEFAULTS.auth.payments),
  signing: Object.keys(DEFAULTS.signing),
  limits: Object.keys(DEFAULTS.limits),
  confirmation: Object.keys(DEFAULTS.confirmation),
};

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

// Returns { config, errors, warnings }. Errors make the config unusable; warnings
// (such as an unknown key, usually a typo) are reported by `doctor`.
export function validateConfig(raw) {
  const errors = [];
  const warnings = [];
  const input = isObject(raw) ? raw : {};
  if (!isObject(raw)) errors.push('The config must be a JSON object.');

  for (const [section, keys] of Object.entries(SECTION_KEYS)) {
    const obj = section ? section.split('.').reduce((o, k) => o?.[k], input) : input;
    if (!isObject(obj)) continue;
    for (const k of Object.keys(obj)) {
      if (!keys.includes(k) && !(section === '' && k === 'permissions')) {
        warnings.push(`Unknown setting "${section ? section + '.' : ''}${k}" is ignored. Valid settings here: ${keys.join(', ')}.`);
      }
    }
  }

  const config = structuredClone(DEFAULTS);

  if (input.environment !== undefined) {
    if (!['live', 'sandbox'].includes(input.environment)) errors.push('"environment" must be "live" or "sandbox".');
    else config.environment = input.environment;
  }

  if (input.permissions !== undefined) errors.push('"permissions" was removed in 0.2.0. Remove that field after reviewing your Starling token scopes; those scopes now control available capabilities.');

  const str = (section, key, { nullable = true } = {}) => {
    const v = input[section]?.[key];
    if (v === undefined) return;
    if ((v === null && nullable) || typeof v === 'string') config[section][key] = v;
    else errors.push(`"${section}.${key}" must be text${nullable ? ' or null' : ''}.`);
  };
  if (input.auth !== undefined && !isObject(input.auth)) errors.push('"auth" must be an object.');
  if (isObject(input.auth)) {
    const legacy = input.auth.tokenEnv !== undefined || input.auth.tokenFile !== undefined;
    if (legacy && input.auth.account !== undefined) errors.push('Use either auth.account or legacy auth.tokenEnv/tokenFile, not both.');
    for (const role of ['account', 'payments']) {
      const source = role === 'account' && legacy ? input.auth : input.auth[role];
      if (source === undefined) continue;
      if (!isObject(source)) { errors.push(`"auth.${role}" must be an object.`); continue; }
      for (const key of ['tokenEnv', 'tokenFile']) {
        const value = source[key];
        if (value === undefined) continue;
        if (key === 'tokenFile' && value === null) config.auth[role][key] = null;
        else if (typeof value === 'string' && value.trim()) config.auth[role][key] = value;
        else errors.push(`"auth.${role}.${key}" must be non-empty text${key === 'tokenFile' ? ' or null' : ''}.`);
      }
    }
  }
  if (isObject(input.signing)) {
    const s = input.signing;
    if (s.keyUid !== undefined) {
      if (s.keyUid === null || (typeof s.keyUid === 'string' && UUID.test(s.keyUid))) config.signing.keyUid = s.keyUid;
      else errors.push('"signing.keyUid" must be the Key Uid from the Starling developer portal (a UUID like aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa) or null.');
    }
    str('signing', 'keyFile');
    if (s.algorithm !== undefined) {
      if (ALGORITHMS.includes(s.algorithm)) config.signing.algorithm = s.algorithm;
      else errors.push(`"signing.algorithm" must be one of: ${ALGORITHMS.join(', ')}.`);
    }
  }

  if (input.defaultAccountUid !== undefined) {
    if (input.defaultAccountUid === null || (typeof input.defaultAccountUid === 'string' && UUID.test(input.defaultAccountUid))) {
      config.defaultAccountUid = input.defaultAccountUid;
    } else errors.push('"defaultAccountUid" must be an account UID (from `accounts list`) or null.');
  }

  if (isObject(input.limits)) {
    const l = input.limits;
    if (l.currency !== undefined) {
      if (typeof l.currency === 'string' && /^[A-Z]{3}$/.test(l.currency)) config.limits.currency = l.currency;
      else errors.push('"limits.currency" must be a 3-letter code in capitals, e.g. "GBP".');
    }
    for (const k of ['perPayment', 'perDay']) {
      if (l[k] === undefined) continue;
      if (l[k] === null || (typeof l[k] === 'number' && Number.isFinite(l[k]) && l[k] > 0)) config.limits[k] = l[k];
      else errors.push(`"limits.${k}" must be a number above zero (in pounds, e.g. 25 or 25.50) or null.`);
    }
    if (config.limits.perPayment != null && config.limits.perDay != null && config.limits.perPayment > config.limits.perDay) {
      warnings.push('"limits.perPayment" is higher than "limits.perDay", so the daily limit will always apply first.');
    }
  }

  if (input.allowedPayees !== undefined) {
    if (Array.isArray(input.allowedPayees) && input.allowedPayees.every((p) => typeof p === 'string')) {
      config.allowedPayees = input.allowedPayees;
    } else errors.push('"allowedPayees" must be a list of payee names or payee UIDs.');
  }

  if (isObject(input.confirmation)) {
    const c = input.confirmation;
    if (c.mode !== undefined) {
      if (['agent', 'terminal'].includes(c.mode)) config.confirmation.mode = c.mode;
      else errors.push('"confirmation.mode" must be "agent" or "terminal".');
    }
    if (c.expiresMinutes !== undefined) {
      if (Number.isInteger(c.expiresMinutes) && c.expiresMinutes >= 1 && c.expiresMinutes <= 60) config.confirmation.expiresMinutes = c.expiresMinutes;
      else errors.push('"confirmation.expiresMinutes" must be a whole number from 1 to 60.');
    }
  }

  return { config, errors, warnings };
}

// Loads config.json or defaults; Starling token scopes determine available capabilities.
export function loadConfig(env = process.env) {
  const file = configPath(env);
  let raw = {};
  let found = false;
  if (existsSync(file)) {
    found = true;
    try {
      raw = parseJsonc(readFileSync(file, 'utf8'));
    } catch (e) {
      throw new CliError('CONFIG_INVALID', `Could not read ${file}: ${e.message}`, {
        hint: 'Fix the JSON syntax (comments are allowed). Compare with config.json.example in the skill folder.',
      });
    }
  }
  const { config, errors, warnings } = validateConfig(raw);
  if (errors.length) {
    throw new CliError('CONFIG_INVALID', `Problems in ${file}:\n- ${errors.join('\n- ')}`, {
      hint: 'Fix these settings, then run `doctor` to re-check. Compare with config.json.example.',
      details: { errors },
    });
  }
  return { config, file, found, warnings };
}

export function loadToken(config, env = process.env, role = 'account') {
  const payment = role === 'payments';
  const auth = config.auth[role];
  const code = payment ? 'NO_PAYMENT_TOKEN' : 'NO_TOKEN';
  const label = payment ? 'optional payment access token' : 'required Starling account access token';
  const hint = payment
    ? 'To send payments, set STARLING_PAYMENT_ACCESS_TOKEN locally or auth.payments.tokenFile. Account access still works without it. Never paste tokens into chat. Run `doctor` after setup.'
    : 'Set STARLING_ACCESS_TOKEN locally or auth.account.tokenFile, then run `doctor`. Never paste tokens into chat. STARLING_PAYMENT_ACCESS_TOKEN is optional and only used to initiate payments.';
  let token, source;
  if (auth.tokenFile) {
    const file = expandHome(auth.tokenFile);
    try { token = readFileSync(file, 'utf8').trim(); }
    catch { throw new CliError(code, `Cannot read the ${label} file: ${file}`, { hint }); }
    source = `file ${file}`;
  } else {
    token = env[auth.tokenEnv]?.trim();
    source = `environment variable ${auth.tokenEnv}`;
  }
  if (!token) throw new CliError(code, `No ${label} found (looked in ${source}).`, { hint });
  registerSecret(token);
  return { token, source };
}

export function fileModeWarning(file) {
  if (process.platform === 'win32') return null;
  try {
    const mode = statSync(file).mode & 0o777;
    if (mode & 0o077) return `${file} is readable by other users (mode ${mode.toString(8)}). Run: chmod 600 ${file}`;
  } catch {
    /* missing files are reported elsewhere */
  }
  return null;
}
