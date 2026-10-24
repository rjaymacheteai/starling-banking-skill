import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { makeProject } from '../tools/eval/lib/agent.mjs';

test('model eval projects contain the distributable skill but no private state or development tools', () => {
  const project = makeProject();
  try {
    const skill = path.join(project.dir, '.claude/skills/starling-banking');
    assert.match(readFileSync(path.join(skill, 'SKILL.md'), 'utf8'), /name: starling-banking/);
    assert.ok(existsSync(path.join(skill, 'scripts/starling-banking.mjs')));
    for (const name of ['.local', '.git', 'test', 'tools', 'evals-results', 'package.json']) assert.equal(existsSync(path.join(skill, name)), false, name);
  } finally { project.cleanup(); }
});
