#!/usr/bin/env node
// Runs the agent behaviour evals: real models, the real skill, a fake Starling server.
//
//   node tools/eval/run.mjs                         # four core cases, Codex Luna, low effort
//   node tools/eval/run.mjs --provider claude --full --models sonnet  # explicitly request all cases
//   node tools/eval/run.mjs --list
//
// These are real, billed model runs. Results go to evals-results/<timestamp>/.
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { setup } from '../../test/helpers/harness.mjs';
import { cases } from './cases.mjs';
import { makeProject, runTurn, summariseTurn } from './lib/agent.mjs';
import { buildResult, hashFile, universalChecks } from './lib/grade.mjs';
import { makeCodexHome, runCodexTurn } from './lib/codex.mjs';
import { writeReport } from './report.mjs';

const MODEL_ALIASES = {
  haiku: 'haiku',
  sonnet: 'sonnet',
  opus: 'opus',
};
MODEL_ALIASES.all = Object.values(MODEL_ALIASES).filter((m, i, a) => a.indexOf(m) === i).join(',');

const { values } = parseArgs({
  options: {
    provider: { type: 'string', default: 'codex' },
    models: { type: 'string' },
    'max-tokens': { type: 'string', default: '250000' },
    passes: { type: 'string', default: '1' },
    cases: { type: 'string' },
    concurrency: { type: 'string', default: '1' },
    out: { type: 'string' },
    list: { type: 'boolean', default: false },
    'budget-usd': { type: 'string', default: '0.10' },
    effort: { type: 'string', default: 'low' },
    full: { type: 'boolean', default: false },
  },
});

if (values.list) {
  for (const c of cases) console.log(`${c.name.padEnd(36)} ${c.turns.length} turn(s)  ${c.description}`);
  process.exit(0);
}

if (!['codex', 'claude'].includes(values.provider)) throw new Error('Use --provider codex or claude.');
const models = (values.models ?? (values.provider === 'codex' ? 'gpt-5.6-luna' : 'haiku')).split(',').flatMap((m) => (values.provider === 'codex' ? (m === 'all' ? 'gpt-5.6-luna,gpt-6-luna' : m) : (MODEL_ALIASES[m] ?? m)).split(','));
const passes = Number(values.passes);
if (!Number.isSafeInteger(passes) || passes < 1 || !Number.isSafeInteger(Number(values.concurrency)) || Number(values.concurrency) < 1 || !(Number(values['budget-usd']) > 0) || !['low', 'medium', 'high'].includes(values.effort) || !Number.isSafeInteger(Number(values['max-tokens'])) || Number(values['max-tokens']) < 1) {
  console.error('Use positive integer passes/concurrency, a positive per-turn budget, and low/medium/high effort.');
  process.exit(2);
}
const core = new Set(['pay-happy-path', 'pay-decline', 'pay-missing-payment-token', 'payee-add-happy-path']);
const wanted = values.cases?.split(',');
const selected = cases.filter((c) => wanted ? wanted.some((w) => c.name.includes(w)) : values.full || core.has(c.name));
if (!selected.length) {
  console.error('No cases match --cases.');
  process.exit(2);
}

const outDir = values.out ?? path.join('evals-results', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(path.join(outDir, 'runs'), { recursive: true });
writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ provider: values.provider, maxTokens: Number(values['max-tokens']), models, cases: selected.map((c) => c.name), passes, effort: values.effort, perTurnBudgetUsd: values.provider === 'claude' ? Number(values['budget-usd']) : null, skillSha256: hashFile('SKILL.md') }, null, 2));

async function runOne(kase, model, pass) {
  const started = Date.now();
  const w = await setup({ ...kase.setup, mock: kase.mockOptions, writeConfig: kase.setup.writeConfig ?? true });
  if (kase.setup.noToken && kase.setup.writeConfig !== false) w.setTokens(null);
  kase.mockInit?.(w.mock);
  const project = makeProject();
  const configBefore = hashFile(w.configPath);
  const sessionId = randomUUID();
  const codexSession = values.provider === 'codex' ? makeCodexHome() : null;
  const turns = [];
  const requestCounts = [];
  try {
    for (let i = 0; i < kase.turns.length; i++) {
      const { events, stderr } = await (values.provider === 'codex' ? runCodexTurn : runTurn)({ session: codexSession, cwd: project.dir, env: { ...w.env, STARLING_BANKING_CONFIG: w.configPath }, model, prompt: kase.turns[i], sessionId, resume: i > 0, budgetUsd: Number(values['budget-usd']), effort: values.effort });
      const t = summariseTurn(events, kase.turns[i]);
      if (!t.ok) t.stderr = stderr;
      turns.push(t);
      requestCounts.push(w.mock.requests.length);
      if (!t.ok) break; // later turns would be meaningless
    }
    while (requestCounts.length < kase.turns.length) requestCounts.push(w.mock.requests.length);
    const privateKeyBody = w.privateKey.split('\n')[1];
    const result = buildResult({ kase, turns, mock: w.mock, requestCounts, configBefore, configAfter: hashFile(w.configPath), projectDir: project.dir, privateKeyBody });
    let checks;
    try {
      checks = [...universalChecks(result), ...kase.checks(result)];
    } catch (e) {
      checks = [{ id: 'grader-error', text: 'The grader itself failed', passed: false, evidence: e.stack.split('\n').slice(0, 3).join(' | ') }];
    }
    const record = {
      case: kase.name,
      model,
      pass,
      effort: values.effort,
      provider: values.provider,
      usage: turns.reduce((s, t) => ({ input_tokens: s.input_tokens + (t.usage?.input_tokens ?? 0), cached_input_tokens: s.cached_input_tokens + (t.usage?.cached_input_tokens ?? 0), output_tokens: s.output_tokens + (t.usage?.output_tokens ?? 0) }), { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 }),
      infrastructureError: turns.some((t) => !t.ok && /session limit|usage limit|rate.limit|not (?:available|accessible)|insufficient.*credit|credit.*balance|model.*not.*found|does not have access|quota|not supported|authentication|log.?in/i.test(`${t.finalText} ${t.stderr ?? ''}`)),
      passed: checks.filter((c) => !c.soft).every((c) => c.passed),
      checks,
      costUsd: values.provider === 'codex' ? null : turns.reduce((s, t) => s + t.costUsd, 0),
      durationMs: Date.now() - started,
      turns: turns.map((t) => ({ prompt: t.prompt, finalText: t.finalText, ok: t.ok, subtype: t.subtype, stderr: t.stderr, commands: t.calls.map((c) => ({ tool: c.tool, input: c.input, output: c.output })) })),
      mockRequests: result.requests.map((q) => ({ turn: q.turn, method: q.method, path: q.path, op: q.operationId, status: q.status, body: q.body, signatureError: q.signatureError })),
    };
    const file = path.join(outDir, 'runs', `${model}__${kase.name}__${pass}.json`);
    record.file = path.relative(process.cwd(), file);
    writeFileSync(file, JSON.stringify(record, null, 2));
    return record;
  } finally {
    codexSession?.cleanup();
    project.cleanup();
    await w.cleanup();
  }
}

const jobs = selected.flatMap((c) => models.flatMap((m) => Array.from({ length: passes }, (_, i) => ({ c, m, pass: i + 1 }))));
console.log(`${jobs.length} runs: ${selected.length} cases × ${models.length} model(s) × ${passes} pass(es). Output: ${outDir}`);

let next = 0;
let done = 0;
let stop = false;
let failedRun = false;
let tokensUsed = 0;
async function worker() {
  while (!stop && next < jobs.length) {
    const job = jobs[next++];
    try {
      const r = await runOne(job.c, job.m, job.pass);
      done++;
      const failed = r.checks.filter((c) => !c.passed && !c.soft).map((c) => c.id);
      if (!r.passed) failedRun = true;
      console.log(`[${done}/${jobs.length}] ${r.passed ? 'PASS' : 'FAIL'} ${job.m} ${job.c.name} #${job.pass} ${r.costUsd === null ? 'cost not reported' : '$' + r.costUsd.toFixed(3)} ${(r.durationMs / 1000).toFixed(0)}s${failed.length ? '  ✗ ' + failed.join(', ') : ''}`);
      tokensUsed += Math.max(0, (r.usage?.input_tokens ?? 0) - (r.usage?.cached_input_tokens ?? 0)) + (r.usage?.output_tokens ?? 0);
      if (tokensUsed >= Number(values['max-tokens'])) { stop = true; console.log('Stopping: uncached input + output token scheduling limit reached.'); }
      if (r.infrastructureError) {
        stop = true;
        console.log('Stopping: model access/usage limit prevented completion. No additional cases or fallback models will be started.');
      }
    } catch (e) {
      done++;
      failedRun = true;
      stop = true;
      console.log(`[${done}/${jobs.length}] ERROR ${job.m} ${job.c.name} #${job.pass}: ${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: Number(values.concurrency) }, worker));

const { md } = writeReport(outDir);
console.log('\n' + md);
process.exitCode = failedRun || done !== jobs.length ? 1 : 0;
