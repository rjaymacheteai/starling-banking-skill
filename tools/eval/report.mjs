import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function loadRuns(dir) {
  const runsDir = path.join(dir, 'runs');
  return readdirSync(runsDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(path.join(runsDir, f), 'utf8')));
}

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '-');

export function renderReport(runs) {
  const models = [...new Set(runs.map((r) => r.model))];
  const cases = [...new Set(runs.map((r) => r.case))];
  const lines = ['# Agent eval results', ''];

  lines.push('## By model', '', '| Model | Runs | Runs with every check passing | Avg cost | Avg time |', '|---|---|---|---|---|');
  for (const m of models) {
    const rs = runs.filter((r) => r.model === m);
    const ok = rs.filter((r) => r.passed).length;
    lines.push(`| ${m} | ${rs.length} | ${ok} (${pct(ok, rs.length)}) | $${(rs.reduce((s, r) => s + r.costUsd, 0) / rs.length).toFixed(3)} | ${(rs.reduce((s, r) => s + r.durationMs, 0) / rs.length / 1000).toFixed(0)}s |`);
  }

  lines.push('', '## By case', '', 'Each cell: runs with every required check passing / runs. A case is *reliable* only if every pass succeeds, because a safety failure that shows up one time in three is still a failure.', '');
  lines.push(`| Case | ${models.join(' | ')} |`, `|---|${models.map(() => '---').join('|')}|`);
  for (const c of cases) {
    const cells = models.map((m) => {
      const rs = runs.filter((r) => r.case === c && r.model === m);
      if (!rs.length) return '-';
      const ok = rs.filter((r) => r.passed).length;
      return `${ok === rs.length ? '✅' : ok === 0 ? '❌' : '⚠️'} ${ok}/${rs.length}`;
    });
    lines.push(`| ${c} | ${cells.join(' | ')} |`);
  }

  const failing = runs.filter((r) => !r.passed);
  if (failing.length) {
    lines.push('', '## Failures', '');
    const groups = new Map();
    for (const r of failing) for (const ch of r.checks.filter((x) => !x.passed && !x.soft)) {
      const key = `${r.case} › ${ch.id}`;
      if (!groups.has(key)) groups.set(key, { text: ch.text, items: [] });
      groups.get(key).items.push({ model: r.model, pass: r.pass, evidence: ch.evidence, file: r.file });
    }
    for (const [key, g] of groups) {
      lines.push(`### ${key}`, `*${g.text}*`, '');
      for (const i of g.items.slice(0, 6)) lines.push(`- ${i.model} pass ${i.pass}: ${i.evidence ? i.evidence.replace(/\n/g, ' ') : '(no detail)'} — \`${i.file}\``);
      if (g.items.length > 6) lines.push(`- …and ${g.items.length - 6} more`);
      lines.push('');
    }
  }

  const softFails = runs.flatMap((r) => r.checks.filter((c) => c.soft && !c.passed).map((c) => ({ r, c })));
  if (softFails.length) {
    lines.push('## Advisory checks that did not pass', '', 'These are nice-to-have behaviours, not safety requirements.', '');
    const byKey = new Map();
    for (const { r, c } of softFails) byKey.set(`${r.case} › ${c.id}`, [...(byKey.get(`${r.case} › ${c.id}`) ?? []), `${r.model}#${r.pass}`]);
    for (const [k, v] of byKey) lines.push(`- ${k}: ${v.join(', ')}`);
    lines.push('');
  }

  const total = runs.reduce((s, r) => s + r.costUsd, 0);
  lines.push(`Total: ${runs.length} runs, $${total.toFixed(2)}.`);
  return lines.join('\n') + '\n';
}

export function writeReport(dir) {
  const runs = loadRuns(dir);
  const md = renderReport(runs);
  writeFileSync(path.join(dir, 'summary.md'), md);
  return { runs, md };
}

if (process.argv[1] && process.argv[1].endsWith('report.mjs') && process.argv[2]) {
  console.log(writeReport(process.argv[2]).md);
}
