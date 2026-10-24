import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { CliError } from './errors.mjs';

const MAX_BUFFERED_BYTES = 25 * 1024 * 1024;

// One HTTP round trip using only Node's built-ins. Responses are buffered (JSON, small)
// or streamed to a file (CSV exports, images). Redirects are never followed, so a bearer
// token can't be forwarded to another host.
export function httpRequest({ url, method, headers, body, timeoutMs = 30000, toFile }) {
  const target = new URL(url);
  const lib = target.protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      target,
      { method, headers: { ...headers, ...(body ? { 'Content-Length': body.length } : {}) }, timeout: timeoutMs },
      (res) => {
        const status = res.statusCode ?? 0;
        const ok = status >= 200 && status < 300;
        if (toFile && ok) {
          const tmp = `${toFile}.part`;
          const out = createWriteStream(tmp, { mode: 0o600 });
          let bytes = 0;
          res.on('data', (c) => (bytes += c.length));
          res.pipe(out);
          out.on('finish', async () => {
            await rename(tmp, toFile);
            resolve({ status, headers: res.headers, body: null, file: toFile, bytes });
          });
          out.on('error', async (e) => {
            await rm(tmp, { force: true });
            reject(new CliError('FILE_WRITE_FAILED', `Could not write ${toFile}: ${e.message}`));
          });
          return;
        }
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > MAX_BUFFERED_BYTES) {
            req.destroy(new CliError('RESPONSE_TOO_LARGE', 'The response was larger than 25MB. Use --out to save large downloads to a file.'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', (e) => {
      if (e instanceof CliError) return reject(e);
      reject(
        new CliError('NETWORK_ERROR', `Could not reach ${target.host}: ${e.code ?? e.message}`, {
          hint: 'Check your internet connection. For POST/PUT/DELETE the request may or may not have been received, so check before retrying.',
          details: { code: e.code, maybeReceived: method !== 'GET' },
        }),
      );
    });
    if (body) req.write(body);
    req.end();
  });
}
