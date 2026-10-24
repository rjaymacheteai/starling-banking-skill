import os from 'node:os';
import path from 'node:path';

// Everything the skill writes at runtime lives under one directory outside the skill
// folder, so updating or reinstalling the skill never touches the user's config or history.
export function homeDir(env = process.env) {
  if (env.STARLING_BANKING_HOME) return env.STARLING_BANKING_HOME;
  if (process.platform === 'win32') {
    return path.join(env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'starling-banking');
  }
  return path.join(env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'starling-banking');
}

export const configPath = (env = process.env) => env.STARLING_BANKING_CONFIG ?? path.join(homeDir(env), 'config.json');
export const stateDir = (env = process.env) => path.join(homeDir(env), 'state');

export function expandHome(p) {
  if (typeof p !== 'string') return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}
