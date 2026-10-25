import { readFileSync } from 'node:fs';
import { CATEGORY_NAMES, getOperation, searchOperations } from '../catalogue.mjs';
import { runOperation } from '../engine.mjs';
import { usage } from '../errors.mjs';
import { fillAccountParams } from '../guards.mjs';
import { UNTRUSTED_NOTICE, keyValues, need, parseBody } from './util.mjs';

export const genericCommands = {
  call: {
    summary: 'Call any Starling API operation by name (see `ops`). Uses the same token routing, payment guards and confirmations as every other command.',
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
    usage: 'ops [search] [--category <name>] [--detail]',
    options: { string: ['category'], boolean: ['detail'] },
    async run(ctx, { flags, positionals }) {
      let ops = searchOperations(positionals[0]);
      if (flags.category) {
        if (!CATEGORY_NAMES.includes(flags.category)) throw usage(`Unknown category "${flags.category}".`, `Categories: ${CATEGORY_NAMES.join(', ')}.`);
        ops = ops.filter((o) => o.category === flags.category);
      }
      return {
        count: ops.length,
        operations: flags.detail
          ? ops
          : ops.map((o) => `${o.operationId.padEnd(40)} ${o.method.padEnd(6)} ${o.path.replace('/api/v2', '')}  [${o.category}${o.signed ? ', signed' : ''}${o.confirm ? ', confirm' : ''}]`),
      };
    },
  },

};
