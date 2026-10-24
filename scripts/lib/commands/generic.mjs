import { readFileSync } from 'node:fs';
import { getOperation, loadCatalogue, searchOperations } from '../catalogue.mjs';
import { GROUPS, GROUP_NAMES } from '../config.mjs';
import { runOperation } from '../engine.mjs';
import { usage } from '../errors.mjs';
import { fillAccountParams } from '../guards.mjs';
import { UNTRUSTED_NOTICE, keyValues, need, parseBody } from './util.mjs';

export const genericCommands = {
  call: {
    summary: 'Call any Starling API operation by name (see `ops`). Uses the same permission checks and confirmations as every other command.',
    usage: 'call <operationId> [--param name=value]... [--query name=value]... [--body <json> | --body-file <path>] [--account <uid|name>] [--out <file>] [--force]',
    options: { multi: ['param', 'query'], string: ['body', 'body-file', 'account', 'out', 'content-type'], boolean: ['force'] },
    async run(ctx, { flags, positionals }) {
      const op = getOperation(need(positionals, 0, 'operationId'));
      const pathParams = await fillAccountParams(ctx, op, keyValues(flags.param, '--param'), flags.account);
      const query = keyValues(flags.query, '--query');
      let body;
      let rawBody;
      if (op.body && !op.body.contentType.includes('json')) {
        if (!flags['body-file']) throw usage(`${op.operationId} sends a file (${op.body.contentType}); pass --body-file <path>.`);
        rawBody = readFileSync(flags['body-file']);
      } else {
        body = parseBody(flags);
      }
      if (op.response !== 'json' && op.response !== 'none' && !flags.out) throw usage(`${op.operationId} returns a file (${op.response}); pass --out <path> to save it.`);
      ctx.notices.push(UNTRUSTED_NOTICE);
      return runOperation(ctx, op.operationId, { pathParams, query, body, rawBody, contentType: flags['content-type'], out: flags.out, force: flags.force });
    },
  },

  ops: {
    summary: 'Search the list of API operations the skill knows about.',
    usage: 'ops [search] [--group <name>] [--detail]',
    options: { string: ['group'], boolean: ['detail'] },
    async run(ctx, { flags, positionals }) {
      let ops = searchOperations(positionals[0]);
      if (flags.group) {
        if (!GROUP_NAMES.includes(flags.group)) throw usage(`Unknown group "${flags.group}".`, `Groups: ${GROUP_NAMES.join(', ')}.`);
        ops = ops.filter((o) => o.group === flags.group);
      }
      const enabled = new Set(ctx.config.permissions);
      return {
        count: ops.length,
        operations: flags.detail
          ? ops.map((o) => ({ ...o, enabled: enabled.has(o.group) }))
          : ops.map((o) => `${o.operationId.padEnd(40)} ${o.method.padEnd(6)} ${o.path.replace('/api/v2', '')}  [${o.group}${enabled.has(o.group) ? '' : ', switched off'}${o.signed ? ', signed' : ''}${o.confirm ? ', confirm' : ''}]`),
      };
    },
  },

  permissions: {
    summary: 'Show which permission groups are switched on in your config, and what each allows.',
    usage: 'permissions',
    options: {},
    async run(ctx) {
      const enabled = new Set(ctx.config.permissions);
      const ops = loadCatalogue().operations;
      return {
        configFile: ctx.configFile,
        configFound: ctx.configFound,
        environment: ctx.config.environment,
        groups: GROUP_NAMES.map((name) => ({
          name,
          enabled: enabled.has(name),
          needsConfirmation: GROUPS[name].needsConfirmation,
          operations: ops.filter((o) => o.group === name).length,
          allows: GROUPS[name].summary,
        })),
        howToChange: `The user edits "permissions" in ${ctx.configFile} (copy config.json.example if it does not exist yet). "view" is always on.`,
      };
    },
  },
};
