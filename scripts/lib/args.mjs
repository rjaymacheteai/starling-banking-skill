import { usage } from './errors.mjs';

// Minimal argument parser: `--flag value`, `--flag=value`, bare boolean flags, repeated
// flags (for `multi`), and positionals. Unknown flags are errors, because a mistyped
// safety flag that is silently ignored is worse than a failure.
export function parseArgs(argv, { boolean = [], multi = [], string = [] } = {}) {
  const known = new Set([...boolean, ...multi, ...string]);
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!a.startsWith('--')) {
      positionals.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const name = (eq === -1 ? a.slice(2) : a.slice(2, eq)).trim();
    if (!known.has(name)) throw usage(`Unknown option --${name}`, `Run with --help to see the options for this command.`);
    if (boolean.includes(name)) {
      flags[name] = eq === -1 ? true : !['false', '0', 'no'].includes(a.slice(eq + 1));
      continue;
    }
    let value;
    if (eq !== -1) value = a.slice(eq + 1);
    else {
      value = argv[++i];
      if (value === undefined || (value.startsWith('--') && value.length > 2)) {
        throw usage(`Option --${name} needs a value`);
      }
    }
    if (multi.includes(name)) (flags[name] ??= []).push(value);
    else flags[name] = value;
  }
  return { flags, positionals };
}

// "key=value" pairs from repeated --param / --query flags.
export function keyValues(list = [], what = 'option') {
  const out = {};
  for (const item of list) {
    const eq = item.indexOf('=');
    if (eq < 1) throw usage(`Expected key=value for ${what}, got "${item}"`);
    out[item.slice(0, eq)] = item.slice(eq + 1);
  }
  return out;
}
