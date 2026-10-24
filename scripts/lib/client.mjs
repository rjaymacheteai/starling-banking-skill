import { existsSync } from 'node:fs';
import path from 'node:path';
import { CliError } from './errors.mjs';
import { httpRequest } from './http.mjs';
import { redact } from './redact.mjs';
import { loadSigner, signedHeaders } from './signing.mjs';

export const VERSION = '0.1.0';
const HOSTS = { live: 'https://api.starlingbank.com', sandbox: 'https://api-sandbox.starlingbank.com' };
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const SAFE_SEGMENT = /^[A-Za-z0-9_.-]+$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// STARLING_BANKING_TEST_BASE_URL exists so the test suite can point at a local mock server.
// It only accepts loopback addresses, so it can't be used to send a token to a remote host.
export function baseUrlFor(config, env = process.env) {
  const override = env.STARLING_BANKING_TEST_BASE_URL;
  if (override) {
    const u = new URL(override);
    if (!LOCAL_HOSTS.has(u.hostname)) {
      throw new CliError('BAD_BASE_URL', 'STARLING_BANKING_TEST_BASE_URL may only point at localhost.');
    }
    return override.replace(/\/$/, '');
  }
  return HOSTS[config.environment];
}

function errorMessage(body, text) {
  if (body && typeof body === 'object') {
    if (body.error_description) return String(body.error_description);
    if (Array.isArray(body.errors) && body.errors.length) return body.errors.map((e) => e.message ?? JSON.stringify(e)).join('; ');
    if (body.message) return String(body.message);
    if (body.error) return String(body.error);
  }
  return text.slice(0, 300);
}

export class StarlingClient {
  constructor({ config, env = process.env, token, retryDelayMs = 1000 }) {
    this.config = config;
    this.env = env;
    this.token = token;
    this.retryDelayMs = retryDelayMs;
    this.baseUrl = baseUrlFor(config, env);
    this.skewMs = null; // server clock minus local clock, from the last response's Date header
    this._signer = null;
  }

  get signer() {
    return (this._signer ??= loadSigner(this.config));
  }

  buildTarget(op, pathParams, query) {
    let p = op.path;
    for (const name of op.pathParams) {
      const value = pathParams[name];
      if (value === undefined || value === '') {
        throw new CliError('MISSING_PARAM', `Missing path parameter "${name}" for ${op.operationId}.`, {
          hint: `Pass it with --param ${name}=<value>.`,
        });
      }
      if (!SAFE_SEGMENT.test(String(value)) || value === '.' || value === '..') {
        throw new CliError('BAD_PARAM', `Path parameter "${name}" contains characters that are not allowed.`);
      }
      p = p.replace(`{${name}}`, encodeURIComponent(value));
    }
    const qs = new URLSearchParams();
    for (const q of op.queryParams) {
      const v = query[q.name];
      if (v === undefined || v === null || v === '') {
        if (q.required) throw new CliError('MISSING_PARAM', `Missing required query parameter "${q.name}" for ${op.operationId}.`, { hint: `Pass it with --query ${q.name}=<value>.` });
        continue;
      }
      qs.set(q.name, String(v));
    }
    const unknown = Object.keys(query).filter((k) => !op.queryParams.some((q) => q.name === k));
    if (unknown.length) throw new CliError('BAD_PARAM', `Unknown query parameter(s) for ${op.operationId}: ${unknown.join(', ')}.`);
    const s = qs.toString();
    return s ? `${p}?${s}` : p;
  }

  // Performs one API operation. Never prints; callers decide what to show.
  async call(op, { pathParams = {}, query = {}, body, rawBody, contentType, out, force = false, timeoutMs } = {}) {
    const target = this.buildTarget(op, pathParams, query);
    let bodyBuffer = null;
    const headers = { Accept: op.response === 'csv' ? 'text/csv' : 'application/json', 'User-Agent': `starling-banking-skill/${VERSION} (unofficial)` };

    if (op.body) {
      if (rawBody) {
        bodyBuffer = rawBody;
        headers['Content-Type'] = contentType ?? op.body.contentType;
      } else if (body !== undefined) {
        bodyBuffer = Buffer.from(JSON.stringify(body), 'utf8'); // the digest must cover exactly these bytes
        headers['Content-Type'] = 'application/json';
      } else if (op.body.required.length) {
        throw new CliError('MISSING_BODY', `${op.operationId} needs a request body (fields: ${op.body.required.join(', ')}).`, { hint: 'Pass --body <json> or --body-file <path>.' });
      }
    }

    if (out) {
      out = path.resolve(out);
      if (existsSync(out) && !force) {
        throw new CliError('FILE_EXISTS', `${out} already exists.`, { hint: 'Choose another --out path or add --force to overwrite.' });
      }
    }

    const attempts = op.method === 'GET' ? 3 : 1;
    for (let attempt = 1; ; attempt++) {
      // A signed request is valid for only 5 seconds, so signing happens right before sending.
      const auth = op.signed
        ? signedHeaders(this.signer, { token: this.token, method: op.method, target, bodyBuffer })
        : { Authorization: `Bearer ${this.token}` };
      const res = await httpRequest({
        url: this.baseUrl + target,
        method: op.method,
        headers: { ...headers, ...auth },
        body: bodyBuffer,
        timeoutMs,
        toFile: out && op.response !== 'json' ? out : undefined,
      });
      if (res.headers.date) this.skewMs = Date.parse(res.headers.date) - Date.now();

      const transient = res.status === 429 || [502, 503, 504].includes(res.status);
      if (transient && attempt < attempts) {
        const wait = Math.min(Number(res.headers['retry-after']) * 1000 || this.retryDelayMs * attempt, 10000);
        await sleep(this.retryDelayMs === 0 ? 0 : wait);
        continue;
      }
      return this.interpret(op, res, out);
    }
  }

  interpret(op, res, out) {
    const ok = res.status >= 200 && res.status < 300;
    if (ok && res.file) return { status: res.status, data: null, file: res.file, bytes: res.bytes };
    const text = res.body ? res.body.toString('utf8') : '';
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    if (ok) {
      if (data && data.success === false) {
        throw new CliError('API_REJECTED', `Starling rejected the request: ${redact(errorMessage(data, text))}`, { details: { status: res.status, body: data } });
      }
      if (out && op.response === 'json') return { status: res.status, data, note: '--out is only used for file downloads; the JSON is shown instead.' };
      return { status: res.status, data, text: data ? undefined : text };
    }
    throw this.httpError(op, res, data, text);
  }

  httpError(op, res, data, text) {
    const message = redact(errorMessage(data, text)) || `HTTP ${res.status}`;
    const details = { status: res.status, operation: op.operationId, body: data ?? undefined };
    const scopeHint = op.scopes.length ? `This needs a token with one of these scopes: ${op.scopes.join(', ')}.` : '';
    switch (res.status) {
      case 400:
        return new CliError('BAD_REQUEST', `Starling rejected the request: ${message}`, { details });
      case 401:
        return new CliError('AUTH_FAILED', 'Starling did not accept the access token.', {
          hint: 'The token may be mistyped, revoked or from another environment (live vs sandbox). Create a new personal access token in the developer portal and run `doctor`.',
          details,
        });
      case 403: {
        const signatureProblem = /signature|digest|date|key/i.test(message) && op.signed;
        if (signatureProblem) {
          return new CliError('SIGNATURE_REJECTED', `Starling rejected the request signature: ${message}`, {
            hint: 'Check signing.keyUid matches the key you uploaded, that the uploaded public key is the pair of your private key file, and that your computer clock is accurate (the allowed drift is 5 seconds). Run `doctor`.',
            details,
          });
        }
        return new CliError('FORBIDDEN', `Starling refused this request (403): ${message}`, {
          hint: `${scopeHint} Edit the token's scopes in the developer portal (or create a new token) and run \`doctor\` to compare.`.trim(),
          details,
        });
      }
      case 404:
        return new CliError('NOT_FOUND', `Not found: ${message}`, { hint: 'Check the UID, and that the token belongs to the account that owns it.', details });
      case 429:
        return new CliError('RATE_LIMITED', 'Starling rate limit reached (personal tokens allow 5 requests/second and 1,000/day).', {
          hint: `Wait ${res.headers['retry-after'] ?? 'a few'} seconds and try again with fewer calls.`,
          details,
        });
      default:
        return new CliError(res.status >= 500 ? 'SERVER_ERROR' : 'HTTP_ERROR', `Starling returned HTTP ${res.status}: ${message}`, {
          hint: op.method === 'GET' ? 'Try again shortly.' : 'The request may or may not have been processed. Check recent transactions or payment status before retrying.',
          details: { ...details, maybeReceived: op.method !== 'GET' },
        });
    }
  }
}
