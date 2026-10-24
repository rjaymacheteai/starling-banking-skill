import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SKILL_SRC = new URL('../../../', import.meta.url).pathname;
const SKILL_FILES = ['SKILL.md', 'config.json.example', 'scripts', 'references', 'data', 'LICENSE', 'THIRD_PARTY_NOTICES.md'];
const TOOLS = 'Bash,Read,Glob,Grep,Skill';

// A throwaway project directory whose only skill is the one under test, so results are not
// influenced by the developer's own skills, settings or memory.
export function makeProject() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sbs-eval-proj-'));
  const dest = path.join(dir, '.claude', 'skills', 'starling-banking');
  mkdirSync(dest, { recursive: true });
  for (const file of SKILL_FILES) cpSync(path.join(SKILL_SRC, file), path.join(dest, file), { recursive: true });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// Runs one user turn with the Claude Code CLI in headless mode and parses the event stream.
export function runTurn({ cwd, env, model, prompt, sessionId, resume, timeoutMs = 90000, budgetUsd = 0.10, effort = 'low' }) {
  const args = [
    '-p', prompt,
    '--model', model,
    '--effort', effort,
    '--output-format', 'stream-json', '--verbose',
    '--setting-sources', 'project',
    '--strict-mcp-config',
    '--tools', TOOLS,
    '--allowedTools', TOOLS,
    '--permission-mode', 'dontAsk',
    '--max-budget-usd', String(budgetUsd),
    ...(resume ? ['--resume', sessionId] : ['--session-id', sessionId]),
  ];
  return new Promise((resolve) => {
    const childEnv = { ...process.env };
    for (const key of Object.keys(childEnv)) if (key.startsWith('STARLING_')) delete childEnv[key];
    Object.assign(childEnv, env);
    const child = spawn('claude', args, { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); resolve({ events: [], stderr: e.message, exitCode: 1 }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const events = [];
      for (const line of out.split('\n')) {
        if (!line.trim()) continue;
        try {
          events.push(JSON.parse(line));
        } catch {
          /* ignore non-JSON noise */
        }
      }
      resolve({ events, stderr: err.slice(0, 2000), exitCode: code });
    });
  });
}

// Turns the raw events of one turn into the facts the graders need.
export function summariseTurn(events, prompt) {
  const result = events.find((e) => e.type === 'result');
  const toolUses = new Map();
  const calls = [];
  const assistantText = [];
  let skillInvoked = false;
  for (const e of events) {
    if (e.type === 'assistant') {
      for (const b of e.message?.content ?? []) {
        if (b.type === 'text' && b.text) assistantText.push(b.text);
        if (b.type === 'tool_use') {
          toolUses.set(b.id, b);
          if (b.name === 'Skill' && /starling-banking/.test(b.input?.skill ?? '')) skillInvoked = true;
        }
      }
    }
    if (e.type === 'user') {
      for (const b of e.message?.content ?? []) {
        if (b.type !== 'tool_result') continue;
        const use = toolUses.get(b.tool_use_id);
        if (!use) continue;
        const text = Array.isArray(b.content) ? b.content.map((c) => c.text ?? '').join('') : String(b.content ?? '');
        calls.push({ tool: use.name, input: use.input, output: text });
      }
    }
  }
  const skillCalls = calls
    .filter((c) => c.tool === 'Bash' && /starling-banking\.mjs/.test(c.input?.command ?? ''))
    .map((c) => {
      const m = c.input.command.match(/starling-banking\.mjs"?\s*(.*)$/s);
      let json;
      try {
        json = JSON.parse(c.output);
      } catch {
        json = undefined;
      }
      return { command: c.input.command, args: (m?.[1] ?? '').trim().replace(/['"]$/, ''), output: c.output, json };
    });
  return {
    prompt,
    finalText: result?.result ?? assistantText.at(-1) ?? '',
    allAssistantText: assistantText.join('\n'),
    calls,
    skillCalls,
    skillInvoked: skillInvoked || calls.some((c) => /(?:cat|sed|read).*starling-banking.*SKILL\.md/.test(c.input?.command ?? '')),
    usage: result?.usage,
    ok: result?.subtype === 'success' && !result?.is_error,
    subtype: result?.subtype ?? 'no_result',
    costUsd: result?.total_cost_usd ?? 0,
    durationMs: result?.duration_ms ?? 0,
    numTurns: result?.num_turns ?? 0,
  };
}
