import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertSandboxConfig, assertSandboxToken } from '../tools/lib/sandbox-guard.mjs';
import { sandboxPaths } from '../tools/lib/sandbox-paths.mjs';
test('sandbox fixtures require the sandbox host and an isolated config', () => {
  const config = { environment: 'sandbox' }, file = '/private/sandbox/config.json';
  assert.doesNotThrow(() => assertSandboxConfig(config, { STARLING_BANKING_CONFIG: file }, file));
  assert.throws(() => assertSandboxConfig({ environment: 'live' }, {}, file), /sandbox API host/);
  assert.throws(() => assertSandboxConfig(config, { STARLING_BANKING_TEST_BASE_URL: 'http://127.0.0.1:1234' }, file), /sandbox API host/);
  assert.throws(() => assertSandboxConfig(config, { STARLING_BANKING_CONFIG: '/private/live/config.json' }, file), /isolated config/);
});
test('known live tokens cannot be used in simulator checks', () => {
  assert.throws(() => assertSandboxToken(' live-test-token\n', ['live-test-token']), /matches a saved live token/);
  assert.throws(() => assertSandboxToken(' ', []), /No sandbox token/);
});
test('simulated holders have separate configs; paths cannot escape the fixture directory', () => {
  const paths = ['individual','individual-2','joint','business'].map((p) => sandboxPaths('/project',p));
  assert.equal(new Set(paths.map((p) => p.configFile)).size,4);
  assert.throws(() => sandboxPaths('/project','../../live'), /Sandbox customer/);
});
