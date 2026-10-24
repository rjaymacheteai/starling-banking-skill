import { parseArgs } from './args.mjs';
import { accountsCommands } from './commands/accounts.mjs';
import { cardsCommands, mandatesCommands, savingsCommands } from './commands/cards-savings.mjs';
import { genericCommands } from './commands/generic.mjs';
import { payeesCommands } from './commands/payees.mjs';
import { paymentsCommands } from './commands/payments.mjs';
import { setupCommands } from './commands/setup.mjs';
import { transactionsCommands } from './commands/transactions.mjs';
import { VERSION } from './client.mjs';
import { createContext } from './context.mjs';
import { runDoctor } from './doctor.mjs';
import { assertGroup } from './engine.mjs';
import { CliError } from './errors.mjs';
import { redact } from './redact.mjs';

const COMMANDS = {
  doctor: {
    summary: 'Check the whole setup (Node, config, token, signing key, clock, permissions) and say how to fix anything wrong.',
    usage: 'doctor [--json]',
    options: { boolean: ['json'] },
    needsContext: false,
    text: true,
    async run({ env }, { flags }) {
      const result = await runDoctor(env);
      return flags.json ? result : { text: result.report, ok: result.ok };
    },
  },
  ...setupCommands,
  ...genericCommands,
  ...accountsCommands,
  ...transactionsCommands,
  ...payeesCommands,
  ...paymentsCommands,
  ...cardsCommands,
  ...savingsCommands,
  ...mandatesCommands,
};

// Write commands name the permission group they need. Checking it first means a switched-off
// action fails immediately, before any lookups or other requests are made.
const REQUIRES = {
  pay: 'payments',
  'payments cancel-standing-order': 'payments',
  'payees add': 'payees',
  'payees add-account': 'payees',
  'payees rename': 'payees',
  'payees update': 'payees',
  'payees delete': 'payees',
  'cards lock': 'card-controls',
  'cards unlock': 'card-controls',
  'cards set': 'card-controls',
  'goals create': 'savings',
  'goals add': 'savings',
  'goals withdraw': 'savings',
  'goals delete': 'savings',
  'mandates cancel': 'account-settings',
  'transactions note': 'organise',
  'transactions categorise': 'organise',
};

function helpText(name) {
  if (name && COMMANDS[name]) {
    const c = COMMANDS[name];
    return `${c.summary}\n\nUsage: starling-banking ${c.usage}`;
  }
  const lines = [`starling-banking ${VERSION} (unofficial Starling Bank skill)`, '', 'Usage: starling-banking <command> [options]', '', 'Commands:'];
  for (const [n, c] of Object.entries(COMMANDS)) lines.push(`  ${n.padEnd(30)} ${c.summary}`);
  lines.push('', 'Every command prints JSON (doctor prints a readable report). Run `<command> --help` for options.', 'Start with: doctor');
  return lines.join('\n');
}

function findCommand(argv) {
  const words = [];
  for (const a of argv) {
    if (a.startsWith('-')) break;
    words.push(a);
    if (words.length === 2) break;
  }
  for (let n = Math.min(2, words.length); n >= 1; n--) {
    const name = words.slice(0, n).join(' ');
    if (COMMANDS[name]) return { name, consumed: n };
  }
  return null;
}

export function render(payload) {
  return redact(JSON.stringify(payload, null, 2));
}

// Runs one CLI invocation and returns { stdout, exitCode }. Nothing here writes to the
// process directly, which keeps it easy to test.
export async function main(argv, env = process.env, overrides = {}) {
  try {
    if (!argv.length || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
      return { stdout: helpText(argv[0] === 'help' ? argv[1] : undefined), exitCode: 0 };
    }
    if (argv[0] === '--version') return { stdout: VERSION, exitCode: 0 };

    const found = findCommand(argv);
    if (!found) {
      throw new CliError('UNKNOWN_COMMAND', `Unknown command "${argv.filter((a) => !a.startsWith('-')).slice(0, 2).join(' ')}".`, { hint: 'Run `help` to list commands.', exit: 2 });
    }
    const command = COMMANDS[found.name];
    const args = argv.slice(found.consumed);
    if (args.includes('--help') || args.includes('-h')) return { stdout: helpText(found.name), exitCode: 0 };

    const { flags, positionals } = parseArgs(args, { string: [], boolean: [], multi: [], ...command.options });
    const ctx = command.needsContext === false ? { env } : createContext(env, overrides);
    if (REQUIRES[found.name]) assertGroup(ctx, REQUIRES[found.name], found.name);
    const result = await command.run(ctx, { flags, positionals });

    if (command.text && result && typeof result.text === 'string') {
      return { stdout: redact(result.text), exitCode: result.ok ? 0 : 1 };
    }
    if (result && result.status === 'needs_confirmation') {
      return { stdout: render({ ...result, command: found.name }), exitCode: 0 };
    }
    const payload = { status: 'ok', command: found.name, data: result };
    if (ctx.notices?.length) payload.notices = [...new Set(ctx.notices)];
    if (result && result.ok === false && result.checks) return { stdout: render({ status: 'error', command: found.name, data: result }), exitCode: 1 };
    return { stdout: render(payload), exitCode: 0 };
  } catch (e) {
    if (e instanceof CliError) {
      const error = { code: e.code, message: redact(e.message), ...(e.hint ? { hint: redact(e.hint) } : {}), ...(e.details ? { details: e.details } : {}) };
      return { stdout: render({ status: 'error', error }), exitCode: e.exit ?? 1 };
    }
    const error = { code: 'INTERNAL_ERROR', message: redact(e?.message ?? String(e)), hint: 'This is a bug in the skill. Run `doctor`, and report it with the command you ran.' };
    return { stdout: render({ status: 'error', error }), exitCode: 70 };
  }
}
