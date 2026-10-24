import { baseUrlFor } from '../../scripts/lib/client.mjs';

export function assertSandboxConfig(config, env, tokenFile) {
  if (config.environment !== 'sandbox' || baseUrlFor(config, env) !== 'https://api-sandbox.starlingbank.com') {
    throw new Error('Sandbox checks require the sandbox API host.');
  }
  if (config.auth.tokenFile !== tokenFile) throw new Error('Sandbox checks require their isolated token file.');
}

export function assertSandboxToken(token, liveTokens) {
  if (!token.trim()) throw new Error('No sandbox token saved.');
  if (liveTokens.some((live) => live.trim() === token.trim())) {
    throw new Error('This matches a saved live token. No API request was made; save a sandbox token instead.');
  }
}
