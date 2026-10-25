#!/usr/bin/env node
// Exercise the actual CLI against the live API. No agents or bank writes.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadConfig } from '../scripts/lib/config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const home = path.join(root, '.local');
const cli = path.join(root, 'scripts/starling-banking.mjs');
const reportFile = path.join(home, 'live-check.json');
const exec = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = { startedAt: new Date().toISOString(), environment: 'live', bankWrites: false, checks: [] };

function save() {
  report.finishedAt = new Date().toISOString();
  report.ok = report.checks.length === report.plannedChecks && report.checks.every((c) => c.status === 'pass');
  writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
}

async function main() {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const env = { ...process.env, STARLING_BANKING_HOME: home, STARLING_BANKING_CONFIG: path.join(home, 'config.json') };
  delete env.STARLING_BANKING_TEST_BASE_URL;
  const { config } = loadConfig(env);
  if (config.environment !== 'live') throw new Error('This check needs a live token and environment: "live". Your config was left unchanged.');
  if (!config.auth.accountToken) throw new Error('Fill auth.accountToken in .local/config.json locally.');

  const exportFile = path.join(home, `live-transactions-${Date.now()}.csv`);
  const cases = [
    { args: ['doctor', '--json'], valid: (d) => d?.ok === true, summary: (d) => ({ checks: d.checks }) },
    { args: ['accounts', 'list'], valid: (d) => Array.isArray(d?.accounts) && d.accounts.length > 0, summary: (d) => ({ accounts: d.accounts.map((a) => ({ name: a.name, currency: a.currency, type: a.accountType })) }) },
    { args: ['accounts', 'balance'], valid: (d) => Object.keys(d?.balances ?? {}).length > 0, summary: (d) => ({ balances: d.balances }) },
    { args: ['accounts', 'identifiers'], valid: (d) => Object.keys(d?.identifiers ?? {}).length > 0, summary: (d) => ({ fields: Object.keys(d.identifiers) }) },
    { args: ['accounts', 'holder'], valid: (d) => !!d?.holder, summary: () => ({ received: true }) },
    { args: ['accounts', 'can-afford', '0.01'], valid: (d) => typeof d?.result?.requestedAmountAvailableToSpend === 'boolean', summary: (d) => ({ result: d.result }) },
    { args: ['transactions', 'list', '--days', '7', '--limit', '3'], valid: (d) => Array.isArray(d?.transactions) && !!d?.range, summary: (d) => ({ range: d.range, count: d.totals.count }) },
    { args: ['payees', 'list'], valid: (d) => Array.isArray(d?.payees), summary: (d) => ({ count: d.payees.length }) },
    { args: ['cards', 'list'], valid: (d) => Array.isArray(d?.cards), summary: (d) => ({ count: d.cards.length }) },
    { args: ['goals', 'list'], valid: (d) => Array.isArray(d?.goals), summary: (d) => ({ count: d.goals.length }) },
    { args: ['spaces', 'list'], valid: (d) => d !== null && typeof d === 'object', summary: () => ({ received: true }) },
    { args: ['mandates', 'list'], valid: (d) => Array.isArray(d?.mandates), summary: (d) => ({ count: d.mandates.length }) },
    { args: ['transactions', 'export', '--days', '7', '--out', exportFile], valid: () => existsSync(exportFile) && statSync(exportFile).size > 0, summary: () => ({ file: exportFile, bytes: statSync(exportFile).size }) },
  ];

  report.plannedChecks = cases.length;
  console.log('Checking the live Starling API using read-only commands. No model calls.');
  for (const [index, kase] of cases.entries()) {
    if (index) await sleep(1100); // Keep requests comfortably below the API's rate limit.
    let stdout;
    let exitCode = 0;
    try {
      ({ stdout } = await exec(process.execPath, [cli, ...kase.args], { env, timeout: 120000, maxBuffer: 4 * 1024 * 1024 }));
    } catch (e) {
      stdout = e.stdout;
      exitCode = e.code ?? 1;
    }
    let result;
    try { result = JSON.parse(stdout); } catch { result = { error: { code: 'CLI_FAILED', message: 'CLI did not return JSON.' } }; }
    const passed = exitCode === 0 && result.status === 'ok' && kase.valid(result.data);
    const diagnostic = result.data?.checks?.find((c) => c.status === 'fail');
    const entry = {
      command: kase.args.join(' '),
      status: passed ? 'pass' : result.error?.code === 'FORBIDDEN' ? 'blocked' : 'fail',
      ...(passed ? { observed: kase.summary(result.data) } : {
        error: result.error ? { code: result.error.code, message: result.error.message, hint: result.error.hint } : diagnostic
          ? { code: 'SETUP_FAILED', message: [diagnostic.title, diagnostic.detail].filter(Boolean).join(': '), hint: diagnostic.fix }
          : { code: 'CHECK_FAILED', message: 'Response did not pass validation.' },
        ...(result.data?.checks ? { diagnostics: result.data.checks } : {}),
      }),
    };
    report.checks.push(entry);
    save();
    console.log(`${entry.status.toUpperCase()} ${kase.args.slice(0, 2).join(' ')}${entry.error ? `: ${entry.error.code}` : ''}`);
    if (entry.error) console.log(entry.error.message);
    // Stop immediately for setup/auth/network problems rather than repeating failed requests.
    if ((index === 0 && !passed) || ['NETWORK_ERROR', 'AUTH_FAILED', 'RATE_LIMITED'].includes(result.error?.code)) break;
  }
  console.log(`Report saved: ${reportFile}`);
  process.exitCode = report.ok && report.checks.length === cases.length ? 0 : 1;
}

main().catch((e) => {
  report.checks.push({ command: 'setup', status: 'fail', error: { message: e.message } });
  try { save(); } catch { /* Report the setup failure even if storage is unavailable. */ }
  console.error(e.message);
  process.exitCode = 1;
});
