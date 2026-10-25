import { baseUrlFor } from '../../scripts/lib/client.mjs';

export function assertSandboxConfig(config, env, configFile) {
  if (config.environment !== 'sandbox' || baseUrlFor(config, env) !== 'https://api-sandbox.starlingbank.com') {
    throw new Error('Sandbox checks require the sandbox API host.');
  }
  if (env.STARLING_BANKING_CONFIG !== configFile) throw new Error('Sandbox checks require their isolated config file.');
}

export function assertSandboxToken(token, liveTokens) {
  if (!token.trim()) throw new Error('No sandbox token saved.');
  if (liveTokens.some((live) => live.trim() === token.trim())) {
    throw new Error('This matches a saved live token. No API request was made; save a sandbox token instead.');
  }
}
