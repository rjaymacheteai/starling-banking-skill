import { loadConfig } from './config.mjs';
import { RoutedClient } from './auth.mjs';
import { Ledger, PlanStore } from './state.mjs';

// Everything a command needs, built lazily so that commands which don't talk to Starling
// (help, init, ops, keys) work before a token exists.
export function createContext(env = process.env, overrides = {}) {
  const loaded = loadConfig(env);
  const ctx = {
    env,
    config: loaded.config,
    configFile: loaded.file,
    configFound: loaded.found,
    configWarnings: loaded.warnings,
    plans: new PlanStore(env),
    ledger: new Ledger(env),
    cache: {},
    notices: [],
    stdin: overrides.stdin ?? process.stdin,
    stdout: overrides.stdout ?? process.stdout,
    retryDelayMs: overrides.retryDelayMs ?? (env.STARLING_BANKING_RETRY_DELAY_MS ? Number(env.STARLING_BANKING_RETRY_DELAY_MS) : 1000),
  };
  let client;
  Object.defineProperty(ctx, 'client', {
    get() {
      if (!client) {
        client = new RoutedClient({ config: ctx.config, env, retryDelayMs: ctx.retryDelayMs });
      }
      return client;
    },
  });
  return ctx;
}
