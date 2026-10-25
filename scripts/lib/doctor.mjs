import { accessSync, constants, mkdirSync } from 'node:fs';
import { StarlingClient, baseUrlFor } from './client.mjs';
import { getOperation, loadCatalogue, scopesSatisfied } from './catalogue.mjs';
import { fileModeWarning, loadConfig, loadToken } from './config.mjs';
import { assertPaymentIdentity } from './auth.mjs';
import { CliError } from './errors.mjs';
import { expandHome, stateDir } from './paths.mjs';
import { loadSigner, selfTest } from './signing.mjs';

const ICON = { pass: '✓', warn: '!', fail: '✗', info: '·' };

// Read-only bank diagnostics and local signing checks. Missing optional payment
// setup never blocks ordinary account access; token scopes come from Starling.
export async function runDoctor(env = process.env) {
  const checks = [];
  const add = (status, title, detail, fix) => checks.push({ status, title, ...(detail ? { detail } : {}), ...(fix ? { fix } : {}) });
  const modeWarning = (file, label) => { const w = fileModeWarning(expandHome(file)); if (w) add('warn', `${label} is readable by other users`, w); };
  const major = Number(process.versions.node.split('.')[0]);
  add(major >= 18 ? 'pass' : 'fail', `Node.js ${process.versions.node}`, major < 18 ? 'Node.js 18 or newer is required.' : undefined);
  try { add('pass', `Operation catalogue loaded (${loadCatalogue().count} operations)`); }
  catch (e) { add('fail', 'Operation catalogue could not be loaded', e.message, 'Reinstall the skill.'); }

  let loaded;
  try { loaded = loadConfig(env); }
  catch (e) { add('fail', 'Config file has problems', e.message, e.hint); return finish(checks); }
  const { config, file, found, warnings } = loaded;
  add(found ? 'pass' : 'info', found ? `Config found at ${file}` : 'No config file; default credential sources apply', undefined, found ? undefined : 'Optional: run `init` to customise settings.');
  for (const w of warnings) add('warn', 'Config setting ignored', w);
  add('info', `Environment: ${config.environment}`, 'Capabilities are controlled by Starling token scopes; there are no local permission switches.');
  try { const dir = stateDir(env); mkdirSync(dir, { recursive: true, mode: 0o700 }); accessSync(dir, constants.W_OK); add('pass', `History folder is writable (${dir})`); }
  catch (e) { add('fail', 'Cannot write to the history folder', e.message, 'Fix folder access or set STARLING_BANKING_HOME.'); }

  let account, identity;
  try {
    const credential = loadToken(config, env);
    add('pass', `Account access token found (${credential.source})`);
    if (config.auth.account.tokenFile) modeWarning(config.auth.account.tokenFile, 'Account token file');
    account = new StarlingClient({ config, env, token: credential.token, retryDelayMs: 0 });
    identity = (await account.call(getOperation('getTokenIdentity'))).data;
    add('pass', `Reached Starling (${baseUrlFor(config, env)}) and the token is accepted`, identity.expiresAt ? `Token expires: ${identity.expiresAt}` : undefined);
    const scopes = identity.scopes ?? [];
    const accessible = loadCatalogue().operations.filter((o) => o.operationId !== 'makeLocalPayment' && scopesSatisfied(o, scopes));
    add('info', `Account token scopes: ${scopes.join(', ') || '(none)'}`, `${accessible.length} catalogued non-initiation operations covered; individual workflows may still require signing or confirmation.`);
    try {
      const accounts = (await account.call(getOperation('getAccounts'))).data?.accounts ?? [];
      add(accounts.length ? 'pass' : 'warn', `${accounts.length} account(s) visible: ${accounts.map((a) => `${a.name} (${a.currency})`).join(', ') || 'none'}`);
      if (accounts.length > 1 && !config.defaultAccountUid) add('info', 'Several accounts and no defaultAccountUid', 'Commands require an unambiguous account.');
    } catch (e) { if (!(e instanceof CliError)) throw e; add('warn', 'Could not list accounts', e.message, e.hint); }
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    add('fail', e.code === 'NO_TOKEN' ? 'Required account access token is missing' : e.code === 'NETWORK_ERROR' ? 'Cannot reach Starling' : 'Starling did not accept the token', `${e.code}: ${e.message}`, e.hint);
  }

  let paymentValid = false, paymentPresent = false;
  try {
    const credential = loadToken(config, env, 'payments');
    paymentPresent = true;
    add('pass', `Optional payment access token found (${credential.source})`);
    if (config.auth.payments.tokenFile) modeWarning(config.auth.payments.tokenFile, 'Payment token file');
    if (identity) {
      const payment = new StarlingClient({ config, env, token: credential.token, tokenRole: 'payments', retryDelayMs: 0 });
      assertPaymentIdentity(identity, (await payment.call(getOperation('getTokenIdentity'))).data);
      paymentValid = true;
      add('pass', 'Payment token is accepted, covers pay-local:create and matches the account holder');
    } else add('info', 'Payment token cannot be verified until required account access is working');
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    const missing = e.code === 'NO_PAYMENT_TOKEN';
    add(missing && !config.auth.payments.tokenFile ? 'info' : 'warn', missing ? 'Optional payment access token is not configured; payments are unavailable' : 'Payment access is unavailable', `${e.code}: ${e.message}`, e.hint);
  }

  const skew = Math.abs(account?.skewMs ?? 0);
  if (account?.skewMs != null) add(skew > 2000 ? 'warn' : 'pass', skew > 2000 ? `Your clock is about ${(skew / 1000).toFixed(1)}s away from Starling's` : 'Clock is in sync with Starling', skew > 2000 ? 'Signed requests require an accurate clock; enable automatic time sync.' : undefined);
  let signingReady = false;
  if (paymentPresent || config.signing.keyUid || config.signing.keyFile) {
    try {
      const signer = loadSigner(config);
      signingReady = selfTest(signer);
      add(signingReady ? 'pass' : 'warn', signingReady ? `Signing key works (${signer.algorithm}, key uid ${signer.keyUid})` : 'Signing key failed its self-test', 'Checked locally; Starling verifies public-key registration on a signed request.');
      modeWarning(signer.keyFile, 'Private key file');
    } catch (e) { if (!(e instanceof CliError)) throw e; add('warn', 'Signing is not ready', e.message, e.hint); }
  } else add('info', 'No signing key configured', 'Read-only use does not need keys. Signed changes require setup.');

  const { perPayment, perDay, currency } = config.limits;
  const limitsReady = perPayment != null && perDay != null;
  if (limitsReady) add('pass', `Spending limits: ${currency} ${perPayment} per payment, ${currency} ${perDay} per day`);
  else add(paymentPresent ? 'warn' : 'info', 'Payment spending limits are not set', 'Set limits.perPayment and limits.perDay only if you want to send payments.');
  if (paymentPresent) {
    add('info', config.allowedPayees.length ? `Payments restricted to: ${config.allowedPayees.join(', ')}` : 'Any registered payee can be paid (allowedPayees is empty)');
    add('info', `Confirmation mode: ${config.confirmation.mode}`, config.confirmation.mode === 'terminal' ? 'User approval requires typing a code in a terminal.' : 'The agent must obtain fresh approval after showing the exact preview.');
  }
  const paymentsReady = !!identity && paymentValid && signingReady && limitsReady && skew <= 4000;
  if (!paymentsReady) add('info', 'Payments are not ready; account access can still be used', 'Resolve payment-specific setup only if you want to send money.');
  return finish(checks, !!identity, paymentsReady);
}

function finish(checks, accountReady = false, paymentsReady = false) {
  const failed = checks.filter((c) => c.status === 'fail').length;
  const warnings = checks.filter((c) => c.status === 'warn').length;
  const report = checks.flatMap((c) => [`${ICON[c.status]} ${c.title}`, ...(c.detail ? [`    ${c.detail}`] : []), ...(c.fix ? [`    → ${c.fix}`] : [])]);
  report.push('', failed ? `${failed} problem(s) need fixing before account access is ready.` : warnings ? 'Account access is ready; review the warnings for optional capabilities.' : 'All good.');
  return { ok: failed === 0, capabilities: { account: { ready: accountReady && !failed }, payments: { ready: paymentsReady && !failed } }, failed, warnings, checks, report: report.join('\n') };
}
