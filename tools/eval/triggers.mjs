#!/usr/bin/env node
// Trigger evals: does the agent load the skill for the right requests, and leave it alone for
// near-misses? Each query is run in an isolated project containing only this skill, and
// stopped at the model's first tool call (loading the skill is the signal), so it is cheap.
//
//   node tools/eval/triggers.mjs --models sonnet --runs 3
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { makeProject } from './lib/agent.mjs';

const MODELS = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5', fable: 'claude-fable-5-1' };
const { values } = parseArgs({
  options: { models: { type: 'string', default: 'sonnet' }, runs: { type: 'string', default: '3' }, concurrency: { type: 'string', default: '6' }, out: { type: 'string' } },
});
const models = (values.models === 'all' ? Object.keys(MODELS) : values.models.split(',')).map((m) => MODELS[m] ?? m);
const runs = Number(values.runs);
const queries = JSON.parse(readFileSync(new URL('./trigger-queries.json', import.meta.url), 'utf8'));

function triggered(query, model, project) {
  const args = ['-p', query, '--model', model, '--output-format', 'stream-json', '--verbose', '--setting-sources', 'project', '--strict-mcp-config', '--tools', 'Bash,Read,Glob,Grep,Skill', '--permission-mode', 'dontAsk', '--allowedTools', 'Bash,Read,Glob,Grep,Skill', '--max-budget-usd', '1'];
  return new Promise((resolve) => {
    const child = spawn('claude', args, { cwd: project, env: { ...process.env, STARLING_ACCESS_TOKEN: '' }, stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = '';
    let decided = false;
    const finish = (value, how) => {
      if (decided) return;
      decided = true;
      child.kill('SIGKILL');
      resolve({ value, how });
    };
    const timer = setTimeout(() => finish(false, 'timeout'), 180000);
    child.stdout.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let e;
        try { e = JSON.parse(line); } catch { continue; }
        if (e.type === 'assistant') {
          const tool = (e.message?.content ?? []).find((b) => b.type === 'tool_use');
          if (tool) {
            const hit = (tool.name === 'Skill' && /starling-banking/.test(tool.input?.skill ?? '')) || (tool.name === 'Read' && /starling-banking/.test(tool.input?.file_path ?? ''));
            return finish(hit, `${tool.name}`);
          }
        }
        if (e.type === 'result') return finish(false, 'answered-without-tools');
      }
    });
    child.on('close', () => { clearTimeout(timer); finish(false, 'closed'); });
  });
}

const jobs = queries.flatMap((q) => models.flatMap((m) => Array.from({ length: runs }, (_, i) => ({ q, m, i }))));
console.log(`${jobs.length} runs (${queries.length} queries × ${models.length} model(s) × ${runs})`);
const results = [];
let next = 0;
await Promise.all(Array.from({ length: Number(values.concurrency) }, async () => {
  const project = makeProject();
  try {
    while (next < jobs.length) {
      const { q, m, i } = jobs[next++];
      const r = await triggered(q.query, m, project.dir);
      results.push({ query: q.query, should: q.should_trigger, model: m, run: i, triggered: r.value, how: r.how });
    }
  } finally {
    project.cleanup();
  }
}));

const lines = ['# Trigger eval results', ''];
for (const m of models) {
  const rs = results.filter((r) => r.model === m);
  const pos = rs.filter((r) => r.should);
  const neg = rs.filter((r) => !r.should);
  const tp = pos.filter((r) => r.triggered).length;
  const fp = neg.filter((r) => r.triggered).length;
  lines.push(`## ${m}`, '', `- Loaded the skill when it should: ${tp}/${pos.length} (${Math.round((100 * tp) / pos.length)}%)`, `- Wrongly loaded it for near-misses: ${fp}/${neg.length} (${Math.round((100 * fp) / neg.length)}%)`, '');
  const bad = queries.map((q) => {
    const rr = rs.filter((r) => r.query === q.query);
    const wrong = rr.filter((r) => r.triggered !== q.should_trigger).length;
    return { q, wrong, n: rr.length, hows: [...new Set(rr.map((r) => r.how))] };
  }).filter((x) => x.wrong > 0);
  if (bad.length) {
    lines.push('Queries that went wrong at least once:', '');
    for (const b of bad) lines.push(`- ${b.q.should_trigger ? 'MISSED' : 'FALSE TRIGGER'} ${b.wrong}/${b.n}: "${b.q.query}" (first action: ${b.hows.join(', ')})`);
    lines.push('');
  }
}
const outFile = values.out ?? path.join('evals-results', `triggers-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
writeFileSync(outFile, lines.join('\n'));
console.log(lines.join('\n'));
