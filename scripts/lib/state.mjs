import crypto from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError } from './errors.mjs';
import { stateDir } from './paths.mjs';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L to avoid misreading
const PLAN_MAX_AGE_MS = 24 * 3600 * 1000;

function ensure(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    // Keys holding undefined are skipped because JSON drops them when the plan is saved to disk.
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function requestHash(request) {
  return crypto.createHash('sha256').update(stable(request)).digest('hex');
}

// Pending confirmations live on disk so the preview and the confirm can be separate
// process runs. The stored hash lets `confirm` detect a plan edited after it was shown.
export class PlanStore {
  constructor(env = process.env) {
    this.dir = path.join(stateDir(env), 'plans');
  }

  fileFor(code) {
    if (!/^[a-z]+-[A-Z0-9]{6}$/.test(code)) {
      throw new CliError('BAD_CODE', `"${code}" is not a valid confirmation code.`, { hint: 'Codes look like pay-7K3QX2 and are shown in the preview.' });
    }
    return path.join(this.dir, `${code}.json`);
  }

  create({ prefix, request, summary, details, meta, expiresMinutes }) {
    ensure(this.dir);
    this.prune();
    const bytes = crypto.randomBytes(6);
    const rand = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    const code = `${prefix}-${rand}`;
    const now = Date.now();
    const plan = {
      code,
      status: 'prepared',
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + expiresMinutes * 60000).toISOString(),
      request,
      requestHash: requestHash(request),
      summary,
      details,
      meta,
    };
    writeFileSync(this.fileFor(code), JSON.stringify(plan, null, 2), { mode: 0o600 });
    return plan;
  }

  load(code) {
    const file = this.fileFor(code);
    if (!existsSync(file)) {
      throw new CliError('PLAN_NOT_FOUND', `No pending action with code ${code}.`, {
        hint: 'It may have expired, been cancelled or already been used. Prepare the action again to get a new code.',
      });
    }
    return JSON.parse(readFileSync(file, 'utf8'));
  }

  save(plan) {
    writeFileSync(this.fileFor(plan.code), JSON.stringify(plan, null, 2), { mode: 0o600 });
    return plan;
  }

  remove(code) {
    rmSync(this.fileFor(code), { force: true });
  }

  prune() {
    if (!existsSync(this.dir)) return;
    for (const f of readdirSync(this.dir)) {
      const file = path.join(this.dir, f);
      try {
        const plan = JSON.parse(readFileSync(file, 'utf8'));
        if (Date.now() - Date.parse(plan.createdAt) > PLAN_MAX_AGE_MS && plan.status !== 'unknown') rmSync(file, { force: true });
      } catch {
        rmSync(file, { force: true });
      }
    }
  }
}

// Append-only record of every write the skill sends. It doubles as the audit trail and
// for status/replay protection. Bodies and secrets are never stored.
export class Ledger {
  constructor(env = process.env) {
    this.file = path.join(stateDir(env), 'ledger.jsonl');
  }

  append(entry) {
    ensure(path.dirname(this.file));
    appendFileSync(this.file, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', { mode: 0o600 });
  }

  entries() {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

}
