import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertSandboxConfig, assertSandboxToken } from '../tools/lib/sandbox-guard.mjs';
import { sandboxPaths } from '../tools/lib/sandbox-paths.mjs';

const config = { environment: 'sandbox', auth: { tokenFile: '/private/sandbox/access-token' } };

test('sandbox checks reject live config, host overrides and shared credential files', () => {
  assert.doesNotThrow(() => assertSandboxConfig(config, {}, '/private/sandbox/access-token'));
  assert.throws(() => assertSandboxConfig({ ...config, environment: 'live' }, {}, '/private/sandbox/access-token'), /sandbox API host/);
  assert.throws(() => assertSandboxConfig(config, { STARLING_BANKING_TEST_BASE_URL: 'http://127.0.0.1:1234' }, '/private/sandbox/access-token'), /sandbox API host/);
  assert.throws(() => assertSandboxConfig({ ...config, auth: { tokenFile: '/private/live/token' } }, {}, '/private/sandbox/access-token'), /isolated token file/);
});

test('a known live token cannot be used in sandbox preflight, even with surrounding whitespace', () => {
  assert.throws(() => assertSandboxToken(' live-test-token\n', ['live-test-token']), /matches a saved live token/);
  assert.throws(() => assertSandboxToken('   ', []), /No sandbox token/);
  assert.doesNotThrow(() => assertSandboxToken('sandbox-test-token', ['live-test-token']));
});

test('sandbox customers have separate credentials and state while sharing application signing keys', () => {
  const profiles = ['individual', 'individual-2', 'joint', 'business'].map((name) => sandboxPaths('/project', name));
  assert.equal(new Set(profiles.map((p) => p.home)).size, 4);
  assert.equal(new Set(profiles.map((p) => p.tokenFile)).size, 4);
  assert.equal(new Set(profiles.map((p) => p.refreshTokenFile)).size, 4);
  assert.equal(new Set(profiles.map((p) => p.keyDir)).size, 1);
  assert.equal(sandboxPaths('/project').home, '/project/.local/sandbox');
  assert.throws(() => sandboxPaths('/project', '../../live'), /Sandbox customer/);
});
