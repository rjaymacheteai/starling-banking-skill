import { existsSync, readFileSync, statSync } from 'node:fs';
import { CliError } from './errors.mjs';
import { parseJsonc } from './jsonc.mjs';
import { configPath, expandHome } from './paths.mjs';
import { registerSecret } from './redact.mjs';

// Permission groups are what the user switches on in config.json. Each one is a
// plain-English capability, not a number, so the config reads like a sentence.
export const GROUPS = {
  view: {
    title: 'View',
    summary: 'Read-only: accounts, balances, transactions, payees, cards, savings goals, direct debits.',
    needsConfirmation: false,
  },
  organise: {
    title: 'Organise',
    summary: 'Edit transaction notes and categories, add receipts and attachments, change the profile image.',
    needsConfirmation: false,
  },
  'card-controls': {
    title: 'Card controls',
    summary: 'Lock or unlock a card and switch ATM, online, contactless, gambling and similar payments on or off.',
    needsConfirmation: false,
  },
  savings: {
    title: 'Savings',
    summary: 'Create and edit savings goals, move money between the account and a goal, manage round-up.',
    needsConfirmation: false,
  },
  payees: {
    title: 'Payees',
    summary: 'Add, edit or delete the people and businesses you can pay. Adding a payee is the first step to paying someone new.',
    needsConfirmation: true,
  },
  payments: {
    title: 'Payments',
    summary: 'Send money to existing payees (and cancel standing orders). Needs spending limits and a signing key.',
    needsConfirmation: true,
  },
  'account-settings': {
    title: 'Account settings',
    summary: 'Change email or address, cancel direct debit mandates, log the token out.',
    needsConfirmation: true,
  },
};

export const GROUP_NAMES = Object.keys(GROUPS);
export const ALGORITHMS = ['auto', 'rsa-sha256', 'rsa-sha512', 'ecdsa-sha256', 'ecdsa-sha512'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DEFAULTS = Object.freeze({
  environment: 'live',
  permissions: ['view'],
  auth: { tokenEnv: 'STARLING_ACCESS_TOKEN', tokenFile: null },
  signing: { keyUid: null, keyFile: null, algorithm: 'auto' },
  defaultAccountUid: null,
  limits: { currency: 'GBP', perPayment: null, perDay: null },
  allowedPayees: [],
  confirmation: { mode: 'agent', expiresMinutes: 10 },
});

const SECTION_KEYS = {
  '': Object.keys(DEFAULTS),
  auth: Object.keys(DEFAULTS.auth),
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
    const obj = section ? input[section] : input;
    if (!isObject(obj)) continue;
    for (const k of Object.keys(obj)) {
      if (!keys.includes(k)) {
        warnings.push(`Unknown setting "${section ? section + '.' : ''}${k}" is ignored. Valid settings here: ${keys.join(', ')}.`);
      }
    }
  }

  const config = structuredClone(DEFAULTS);
  config.permissions = [...DEFAULTS.permissions];

  if (input.environment !== undefined) {
    if (!['live', 'sandbox'].includes(input.environment)) errors.push('"environment" must be "live" or "sandbox".');
    else config.environment = input.environment;
  }

  if (input.permissions !== undefined) {
    if (!Array.isArray(input.permissions) || input.permissions.some((p) => typeof p !== 'string')) {
      errors.push(`"permissions" must be a list of names from: ${GROUP_NAMES.join(', ')}.`);
    } else {
      const unknown = input.permissions.filter((p) => !GROUP_NAMES.includes(p));
      if (unknown.length) errors.push(`Unknown permission ${unknown.map((u) => `"${u}"`).join(', ')}. Valid names: ${GROUP_NAMES.join(', ')}.`);
      config.permissions = [...new Set(['view', ...input.permissions.filter((p) => GROUP_NAMES.includes(p))])];
    }
  }

  const str = (section, key, { nullable = true } = {}) => {
    const v = input[section]?.[key];
    if (v === undefined) return;
    if ((v === null && nullable) || typeof v === 'string') config[section][key] = v;
    else errors.push(`"${section}.${key}" must be text${nullable ? ' or null' : ''}.`);
  };
  if (isObject(input.auth)) {
    str('auth', 'tokenEnv', { nullable: false });
    str('auth', 'tokenFile');
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

// Loads config.json (or defaults, so view-only use works with just a token).
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

export function loadToken(config, env = process.env) {
  let token;
  let source;
  if (config.auth.tokenFile) {
    const file = expandHome(config.auth.tokenFile);
    if (!existsSync(file)) {
      throw new CliError('NO_TOKEN', `Token file not found: ${file}`, { hint: 'Create it with your Starling personal access token, or use an environment variable instead (auth.tokenEnv).' });
    }
    token = readFileSync(file, 'utf8').trim();
    source = `file ${file}`;
  } else {
    const name = config.auth.tokenEnv;
    token = env[name]?.trim();
    source = `environment variable ${name}`;
  }
  if (!token) {
    throw new CliError('NO_TOKEN', `No Starling access token found (looked in ${config.auth.tokenFile ? 'the token file' : `environment variable ${config.auth.tokenEnv}`}).`, {
      hint: 'Create a personal access token at https://developer.starlingbank.com (Personal Access), then set it in your shell: export STARLING_ACCESS_TOKEN=... (do not paste it into the chat). Run `doctor` for guided setup.',
    });
  }
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
