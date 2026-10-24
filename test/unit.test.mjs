import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseArgs } from '../scripts/lib/args.mjs';
import { loadCatalogue, scopesSatisfied } from '../scripts/lib/catalogue.mjs';
import { GROUP_NAMES, GROUPS, validateConfig } from '../scripts/lib/config.mjs';
import { parseJsonc } from '../scripts/lib/jsonc.mjs';
import { formatMoney, parseAmount } from '../scripts/lib/money.mjs';
import { clearSecrets, redact, registerSecret } from '../scripts/lib/redact.mjs';
import { digestOf, resolveAlgorithm, selfTest, signText, signedHeaders, signingString } from '../scripts/lib/signing.mjs';

const EXAMPLE = new URL('../config.json.example', import.meta.url);

test('catalogue preserves date and date-time query formats from the official interface', () => {
  const ops = loadCatalogue().operations;
  const param = (operationId, name) => ops.find((o) => o.operationId === operationId).queryParams.find((q) => q.name === name);
  assert.equal(param('downloadCSVFeedExportForDateRange', 'start').format, 'date');
  assert.equal(param('listPaymentsForPayeeAccount', 'since').format, 'date');
  assert.equal(param('queryFeedItemsByCategoryWithTransactionTimesBetween', 'minTransactionTimestamp').format, 'date-time');
});

test('parseJsonc: comments, trailing commas, and URLs inside strings', () => {
  const v = parseJsonc(`{
    // line comment
    "a": "http://example.com/x", /* block */
    "b": [1, 2,],
    "c": "has // inside",
  }`);
  assert.deepEqual(v, { a: 'http://example.com/x', b: [1, 2], c: 'has // inside' });
});

test('the shipped config.json.example parses and validates with no errors', () => {
  const { config, errors, warnings } = validateConfig(parseJsonc(readFileSync(EXAMPLE, 'utf8')));
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.deepEqual(config.permissions, ['view']);
});

test('every permission group and setting named in config.json.example is documented there', () => {
  const text = readFileSync(EXAMPLE, 'utf8');
  for (const g of GROUP_NAMES) assert.ok(text.includes(`"${g}"`), `group ${g} is not described in config.json.example`);
  for (const key of ['environment', 'permissions', 'tokenEnv', 'tokenFile', 'keyUid', 'keyFile', 'algorithm', 'defaultAccountUid', 'perPayment', 'perDay', 'allowedPayees', 'mode', 'expiresMinutes']) {
    assert.ok(text.includes(`"${key}"`), `setting ${key} is missing from config.json.example`);
  }
});

test('config validation gives plain-English errors and always keeps "view" on', () => {
  const bad = validateConfig({ permissions: ['view', 'sendmoney'], limits: { perPayment: -5 }, environment: 'prod', signing: { keyUid: 'nope' }, confirmation: { mode: 'chat' }, tpyo: 1 });
  assert.equal(bad.errors.length, 5);
  assert.match(bad.errors.join('\n'), /Unknown permission "sendmoney"/);
  assert.match(bad.errors.join('\n'), /"environment" must be "live" or "sandbox"/);
  assert.match(bad.warnings.join('\n'), /Unknown setting "tpyo"/);
  const ok = validateConfig({ permissions: ['payments'] });
  assert.deepEqual(ok.config.permissions, ['view', 'payments']);
});

test('parseAmount accepts only exact positive pounds-and-pence', () => {
  assert.equal(parseAmount('25'), 2500);
  assert.equal(parseAmount('25.5'), 2550);
  assert.equal(parseAmount('£1,000'.replace(',', '')), 100000);
  assert.equal(parseAmount('0.01'), 1);
  for (const bad of ['0', '-5', '1.234', 'abc', '', '1e3', '10.', '.5']) assert.throws(() => parseAmount(bad), /valid amount|greater than zero/, `should reject "${bad}"`);
  assert.equal(formatMoney(123456, 'GBP'), '£1,234.56');
  assert.equal(formatMoney(5, 'GBP'), '£0.05');
  assert.equal(formatMoney(100, 'JPY'), '1.00 JPY');
});

test('parseArgs rejects unknown flags rather than ignoring them', () => {
  assert.throws(() => parseArgs(['--ammount', '5'], { string: ['amount'] }), /Unknown option --ammount/);
  const r = parseArgs(['x', '--amount=5', '--force', '--param', 'a=1', '--param', 'b=2'], { string: ['amount'], boolean: ['force'], multi: ['param'] });
  assert.deepEqual(r, { flags: { amount: '5', force: true, param: ['a=1', 'b=2'] }, positionals: ['x'] });
});

test('redact removes registered secrets, JWT-shaped tokens, bearer headers and private keys', () => {
  clearSecrets();
  registerSecret('super-secret-value-123');
  const out = redact('token super-secret-value-123 and eyJhbGciOiJQUzI1NiJ9.abc.def and Bearer abc123xyz; Signature keyid="k",signature="AAAA==" -----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----');
  assert.ok(!/super-secret|eyJ|abc123xyz|AAAA==|MIIE/.test(out), out);
  clearSecrets();
});

test('catalogue: every write operation belongs to a known group and the confirm flags are right', () => {
  const { operations } = loadCatalogue();
  assert.equal(operations.length, loadCatalogue().count);
  for (const o of operations) {
    assert.ok(GROUP_NAMES.includes(o.group), `${o.operationId} has unknown group ${o.group}`);
    assert.equal(o.group === 'view', o.method === 'GET', `${o.operationId}: only GETs belong in "view"`);
    assert.equal(o.confirm, GROUPS[o.group].needsConfirmation, `${o.operationId}: confirm flag disagrees with its group`);
    if (o.signed) assert.ok(['payments', 'account-settings'].includes(o.group), `${o.operationId}: signed operations must need confirmation`);
  }
  // Money leaving the account can never sit in an unconfirmed group.
  for (const id of ['makeLocalPayment', 'createStandingOrder', 'updateStandingOrder', 'cancelStandingOrder', 'createPayee', 'createPayeeAccount', 'updatePayee', 'deletePayee']) {
    assert.equal(operations.find((o) => o.operationId === id).confirm, true, id);
  }
});

test('scopesSatisfied treats an operation\'s scopes as alternatives', () => {
  const op = { scopes: ['account:read', 'account-list:read'] };
  assert.equal(scopesSatisfied(op, ['account-list:read']), true);
  assert.equal(scopesSatisfied(op, ['balance:read']), false);
  assert.equal(scopesSatisfied({ scopes: [] }, []), true);
});

// ---- message signing -------------------------------------------------------------------

test('known answer: Starling\'s own sample signature verifies with Node (RSA PKCS#1 v1.5 + SHA-512)', () => {
  const v = JSON.parse(readFileSync(new URL('./fixtures/starling-webhook-vector.json', import.meta.url), 'utf8'));
  const key = crypto.createPublicKey({ key: Buffer.from(v.publicKeyBase64, 'base64'), format: 'der', type: 'spki' });
  assert.equal(crypto.verify('sha512', Buffer.from(v.payload), key, Buffer.from(v.signatureBase64, 'base64')), true);
  assert.equal(crypto.verify('sha512', Buffer.from(v.payload + ' '), key, Buffer.from(v.signatureBase64, 'base64')), false);
});

test('signing string and digest follow the documented format', () => {
  assert.equal(
    signingString({ method: 'PUT', target: '/api/v2/payments/local/account/a/category/c', date: '2020-04-07T18:26:30.668Z', digest: 'D' }),
    '(request-target): put /api/v2/payments/local/account/a/category/c\nDate: 2020-04-07T18:26:30.668Z\nDigest: D',
  );
  assert.equal(digestOf(null), 'X');
  assert.equal(digestOf(Buffer.alloc(0)), 'X');
  assert.equal(digestOf(Buffer.from('{}')), crypto.createHash('sha512').update('{}').digest('base64'));
});

for (const type of ['rsa', 'ec']) {
  test(`signing round trip with a ${type.toUpperCase()} key verifies and the header has Starling's shape`, () => {
    const { privateKey, publicKey } = type === 'rsa'
      ? crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
      : crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const algorithm = resolveAlgorithm(privateKey);
    assert.equal(algorithm, type === 'rsa' ? 'rsa-sha512' : 'ecdsa-sha512');
    const signer = { keyUid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', key: privateKey, algorithm };
    assert.equal(selfTest(signer), true);

    const body = Buffer.from('{"a":1}');
    const now = new Date('2026-01-02T03:04:05.678Z');
    const h = signedHeaders(signer, { token: 'TOK', method: 'PUT', target: '/x', bodyBuffer: body, now });
    assert.equal(h.Date, '2026-01-02T03:04:05.678Z');
    assert.equal(h.Digest, digestOf(body));
    const m = h.Authorization.match(/^Bearer TOK;Signature keyid="([^"]+)",algorithm="([^"]+)",headers="\(request-target\) Date Digest",signature="([^"]+)"$/);
    assert.ok(m, h.Authorization);
    const text = signingString({ method: 'PUT', target: '/x', date: h.Date, digest: h.Digest });
    assert.equal(crypto.verify(algorithm.endsWith('512') ? 'sha512' : 'sha256', Buffer.from(text), { key: publicKey, dsaEncoding: 'der' }, Buffer.from(m[3], 'base64')), true);
    // Changing anything breaks it.
    assert.equal(crypto.verify('sha512', Buffer.from(text + 'x'), { key: publicKey, dsaEncoding: 'der' }, Buffer.from(m[3], 'base64')), false);
    assert.ok(signText(signer, text));
  });
}

test('keys outside Starling\'s requirements are rejected with a clear reason', () => {
  const small = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey;
  assert.throws(() => resolveAlgorithm(small), /requires 2048 or 4096/);
  const p384 = crypto.generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).privateKey;
  assert.throws(() => resolveAlgorithm(p384), /P-256/);
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  assert.throws(() => resolveAlgorithm(rsa, 'ecdsa-sha512'), /does not match the RSA key/);
});
