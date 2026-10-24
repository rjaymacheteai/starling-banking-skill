import { readFileSync } from 'node:fs';
import { CliError } from './errors.mjs';

const FILE = new URL('../../data/operations.json', import.meta.url);

let cache;
export function loadCatalogue() {
  if (!cache) cache = JSON.parse(readFileSync(FILE, 'utf8'));
  return cache;
}

export function getOperation(operationId) {
  const op = loadCatalogue().operations.find((o) => o.operationId === operationId);
  if (!op) {
    throw new CliError('UNKNOWN_OPERATION', `No such operation: ${operationId}`, {
      hint: 'Run `ops <search>` to find operation names, e.g. `ops payee`.',
    });
  }
  return op;
}

export function searchOperations(term) {
  const ops = loadCatalogue().operations;
  if (!term) return ops;
  const t = term.toLowerCase();
  return ops.filter((o) =>
    [o.operationId, o.path, o.summary, o.tag ?? '', o.group].some((f) => f.toLowerCase().includes(t)),
  );
}

// Starling lists several scopes per operation; holding any one of them is enough.
export function scopesSatisfied(op, granted) {
  if (!op.scopes.length) return true;
  const have = new Set(granted);
  return op.scopes.some((s) => have.has(s));
}
