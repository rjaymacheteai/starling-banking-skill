import { accessSync, constants, mkdirSync } from 'node:fs';
import { StarlingClient, baseUrlFor } from './client.mjs';
import { getOperation, loadCatalogue, scopesSatisfied } from './catalogue.mjs';
import { GROUPS, fileModeWarning, loadConfig, loadToken } from './config.mjs';
import { CliError } from './errors.mjs';
import { expandHome, stateDir } from './paths.mjs';
import { loadSigner, selfTest } from './signing.mjs';

const ICON = { pass: '✓', warn: '!', fail: '✗', info: '·' };

// Walks through every part of the setup and says what to do about anything wrong.
// It prints no secrets: tokens and keys are reported only as "found" or "missing".
export async function runDoctor(env = process.env) {
  const checks = [];
  const add = (status, title, detail, fix) => checks.push({ status, title, ...(detail ? { detail } : {}), ...(fix ? { fix } : {}) });

  // 1. Runtime
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 18) add('pass', `Node.js ${process.versions.node}`);
  else add('fail', `Node.js ${process.versions.node} is too old`, 'This skill needs Node.js 18 or newer.', 'Install the current LTS from https://nodejs.org, then run this check again.');

  try {
    add('pass', `Operation catalogue loaded (${loadCatalogue().count} operations)`);
  } catch (e) {
    add('fail', 'Operation catalogue could not be loaded', e.message, 'Reinstall the skill: data/operations.json is missing or damaged.');
  }

  // 2. Config
  let loaded;
  try {
    loaded = loadConfig(env);
  } catch (e) {
    add('fail', 'Config file has problems', e.message, e.hint);
    return finish(checks);
  }
  const { config, file, found, warnings } = loaded;
  if (found) add('pass', `Config found at ${file}`);
  else add('warn', 'No config file yet, so safe defaults apply (view-only)', `Looked for ${file}.`, 'Run `init` to create one from the example, then edit it to switch on more permissions.');
  for (const w of warnings) add('warn', 'Config setting ignored', w);
  add('info', `Environment: ${config.environment}`, config.environment === 'sandbox' ? 'Sandbox uses fake data and tokens from the developer portal simulator.' : 'Live: this is your real bank account.');
  add('info', `Permissions switched on: ${config.permissions.join(', ')}`, config.permissions.length === 1 ? 'Read-only. Add more groups in config.json when you want the agent to do more (see config.json.example).' : undefined);

  // 3. State directory
  try {
    const dir = stateDir(env);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    accessSync(dir, constants.W_OK);
    add('pass', `History folder is writable (${dir})`);
  } catch (e) {
    add('fail', 'Cannot write to the history folder', e.message, 'Fix the folder permissions, or set STARLING_BANKING_HOME to a folder you can write to. Payments need this to keep the spending ledger.');
  }

  // 4. Token
  let token;
  try {
    const t = loadToken(config, env);
    token = t.token;
    add('pass', `Access token found (${t.source})`);
    if (config.auth.tokenFile) {
      const w = fileModeWarning(expandHome(config.auth.tokenFile));
      if (w) add('warn', 'Token file is readable by other users', w);
    }
  } catch (e) {
    add('fail', 'No access token', e.message, e.hint);
  }

  const needsSigning = config.permissions.some((g) => ['payments', 'account-settings'].includes(g));
  let client;
  let identity;

  // 5. Reaching Starling and checking the token
  if (token) {
    try {
      client = new StarlingClient({ config, env, token, retryDelayMs: 0 });
      const res = await client.call(getOperation('getTokenIdentity'));
      identity = res.data;
      add('pass', `Reached Starling (${baseUrlFor(config, env)}) and the token is accepted`, identity?.expiresAt ? `Token expires: ${identity.expiresAt}` : 'This token does not expire.');
    } catch (e) {
      if (e instanceof CliError) add('fail', e.code === 'NETWORK_ERROR' ? 'Cannot reach Starling' : 'Starling did not accept the token', e.message, e.hint);
      else throw e;
      client = null;
    }
  }

  // 6. Clock (signed requests are only valid for 5 seconds)
  if (client?.skewMs != null) {
    const s = Math.abs(client.skewMs);
    if (s > 4000) add(needsSigning ? 'fail' : 'warn', `Your clock is about ${(s / 1000).toFixed(1)}s away from Starling's`, 'Signed requests (payments) are rejected if the clock differs by more than 5 seconds.', 'Turn on automatic time sync in your operating system settings.');
    else if (s > 2000) add('warn', `Your clock is about ${(s / 1000).toFixed(1)}s away from Starling's`, 'Close to the 5-second limit for signed requests.', 'Make sure automatic time sync is on.');
    else add('pass', 'Clock is in sync with Starling');
  }

  // 7. Scopes against switched-on permissions
  if (identity?.scopes) {
    const granted = identity.scopes;
    add('info', `Token scopes: ${granted.length ? granted.join(', ') : '(none)'}`);
    const ops = loadCatalogue().operations;
    for (const group of config.permissions) {
      const blocked = ops.filter((o) => o.group === group && !scopesSatisfied(o, granted));
      if (!blocked.length) {
        add('pass', `Token covers everything in "${group}"`);
        continue;
      }
      const total = ops.filter((o) => o.group === group).length;
      const missing = [...new Set(blocked.flatMap((o) => o.scopes))].sort();
      const essential = group !== 'view';
      add(essential ? 'warn' : 'info', `Token cannot use ${blocked.length} of ${total} "${group}" operations`, `Missing scopes (any one per operation is enough): ${missing.join(', ')}`, 'Fine if you do not need those. Otherwise create a new token in the developer portal with the scopes ticked.');
    }
    for (const group of Object.keys(GROUPS)) {
      if (config.permissions.includes(group)) continue;
      const covered = loadCatalogue().operations.filter((o) => o.group === group && scopesSatisfied(o, granted)).length;
      if (covered && group !== 'view') add('info', `Token could also do ${covered} "${group}" operations, but that group is switched off`, 'Good: the config limits what the agent can do even though the token could do more.');
    }
  }

  // 8. Accounts
  if (client && identity) {
    try {
      const res = await client.call(getOperation('getAccounts'));
      const accounts = res.data?.accounts ?? [];
      add(accounts.length ? 'pass' : 'warn', `${accounts.length} account(s) visible: ${accounts.map((a) => `${a.name} (${a.currency})`).join(', ') || 'none'}`, undefined, accounts.length ? undefined : 'The token needs the account:read or account-list:read scope.');
      if (accounts.length > 1 && !config.defaultAccountUid) add('info', 'Several accounts and no defaultAccountUid', 'Commands will ask which account to use when it is not obvious.', 'Optional: set defaultAccountUid in config.json.');
    } catch (e) {
      if (e instanceof CliError) add('warn', 'Could not list accounts', e.message, e.hint);
      else throw e;
    }
  }

  // 9. Signing
  const configured = config.signing.keyUid || config.signing.keyFile;
  if (needsSigning || configured) {
    try {
      const signer = loadSigner(config);
      const keyWarn = fileModeWarning(signer.keyFile);
      if (selfTest(signer)) add('pass', `Signing key works (${signer.algorithm}, key uid ${signer.keyUid})`, 'Checked locally. Starling confirms the key only when a signed request is made.');
      else add('fail', 'Signing key failed its self-test');
      if (keyWarn) add('warn', 'Private key file is readable by other users', keyWarn);
    } catch (e) {
      if (e instanceof CliError) add(needsSigning ? 'fail' : 'warn', 'Signing is not ready', e.message, e.hint);
      else throw e;
    }
  } else {
    add('info', 'No signing key configured', 'Not needed for read-only use. Payments and account changes require one.');
  }

  // 10. Payment safety settings
  if (config.permissions.includes('payments')) {
    const { perPayment, perDay, currency } = config.limits;
    if (perPayment == null || perDay == null) add('fail', 'Payments are on but spending limits are not set', undefined, 'Set limits.perPayment and limits.perDay in config.json (in pounds, e.g. 25 and 100).');
    else add('pass', `Spending limits: ${currency} ${perPayment} per payment, ${currency} ${perDay} per day`);
    add('info', config.allowedPayees.length ? `Payments restricted to: ${config.allowedPayees.join(', ')}` : 'Any registered payee can be paid (allowedPayees is empty)', 'Adding names to allowedPayees limits payments to those people only.');
    add('info', `Confirmation mode: ${config.confirmation.mode}`, config.confirmation.mode === 'agent' ? 'The agent shows you each payment and asks for a yes in chat before confirming.' : 'You must approve each payment by typing a code in a terminal.');
  }

  return finish(checks);
}

function finish(checks) {
  const failed = checks.filter((c) => c.status === 'fail').length;
  const warned = checks.filter((c) => c.status === 'warn').length;
  const lines = [];
  for (const c of checks) {
    lines.push(`${ICON[c.status]} ${c.title}`);
    if (c.detail) lines.push(`    ${c.detail}`);
    if (c.fix) lines.push(`    → ${c.fix}`);
  }
  lines.push('');
  lines.push(failed ? `${failed} problem(s) need fixing before everything works.` : warned ? `Ready to use, with ${warned} thing(s) worth a look.` : 'All good.');
  return { ok: failed === 0, failed, warnings: warned, checks, report: lines.join('\n') };
}
