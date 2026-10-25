import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { main } from '../scripts/lib/cli.mjs';

test('doctor reports a missing config as failure in both JSON and text modes', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'sbs-doctor-offline-'));
  try {
    const env = { STARLING_BANKING_HOME: home };
    const json = await main(['doctor', '--json'], env);
    const report = JSON.parse(json.stdout);
    assert.equal(json.exitCode, 1);
    assert.equal(report.status, 'error');
    assert.equal(report.data.ok, false);
    assert.ok(report.data.checks.some((c) => c.status === 'fail' && c.title === 'No local config.json found'));
    const text = await main(['doctor'], env);
    assert.equal(text.exitCode, 1);
    assert.match(text.stdout, /No local config.json found/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
