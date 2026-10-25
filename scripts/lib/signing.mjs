import crypto from 'node:crypto';
import { ALGORITHMS } from './config.mjs';
import { CliError } from './errors.mjs';
import { registerSecret } from './redact.mjs';

// Message signing as documented at https://developer.starlingbank.com/docs
// ("API keys and message signing"). The signed text is:
//   (request-target): <method> <path>\nDate: <date>\nDigest: <digest>
// where Digest is the base64 SHA-512 of the exact request body bytes ("X" when there is none).

const HASH = { 'rsa-sha256': 'sha256', 'rsa-sha512': 'sha512', 'ecdsa-sha256': 'sha256', 'ecdsa-sha512': 'sha512' };

export function loadSigner(config) {
  const { keyUid, privateKey: pem } = config.signing;
  if (!keyUid || !pem) throw new CliError('SIGNING_NOT_CONFIGURED', 'This action needs an API signing key and its registered Key UID.', { hint: 'Run `keys generate` for requested setup, register the public key, then fill signing.keyUid in local config.json. The private key stays in signing.privateKey; never paste it into chat.' });
  registerSecret(pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, ''));
  let key;
  try { key = crypto.createPrivateKey(pem); }
  catch { throw new CliError('SIGNING_KEY_INVALID', 'signing.privateKey is not a valid unencrypted PEM private key.', { hint: 'Use an RSA 2048/4096 or ECDSA P-256 private key in local config.json.' }); }
  const algorithm = resolveAlgorithm(key, config.signing.algorithm);
  return { keyUid, key, algorithm };
}

export function resolveAlgorithm(key, requested = 'auto') {
  const type = key.asymmetricKeyType;
  if (type !== 'rsa' && type !== 'ec') {
    throw new CliError('SIGNING_KEY_INVALID', `Unsupported key type "${type}". Starling accepts RSA or ECDSA keys.`);
  }
  if (type === 'rsa') {
    const bits = key.asymmetricKeyDetails?.modulusLength;
    if (bits !== 2048 && bits !== 4096) {
      throw new CliError('SIGNING_KEY_INVALID', `RSA key is ${bits} bits; Starling requires 2048 or 4096.`);
    }
  } else if (key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new CliError('SIGNING_KEY_INVALID', `ECDSA key uses curve ${key.asymmetricKeyDetails?.namedCurve}; Starling requires P-256 (prime256v1).`);
  }
  const algorithm = requested === 'auto' ? (type === 'rsa' ? 'rsa-sha512' : 'ecdsa-sha512') : requested;
  if (!ALGORITHMS.includes(algorithm) || algorithm === 'auto') throw new CliError('SIGNING_KEY_INVALID', `Unknown algorithm ${requested}.`);
  if (algorithm.startsWith('rsa') !== (type === 'rsa')) {
    throw new CliError('SIGNING_KEY_INVALID', `signing.algorithm "${algorithm}" does not match the ${type.toUpperCase()} key.`, {
      hint: 'Set signing.algorithm to "auto" and the right one is chosen from the key.',
    });
  }
  return algorithm;
}

export function digestOf(bodyBuffer) {
  if (!bodyBuffer || bodyBuffer.length === 0) return 'X';
  return crypto.createHash('sha512').update(bodyBuffer).digest('base64');
}

export function signingString({ method, target, date, digest }) {
  return `(request-target): ${method.toLowerCase()} ${target}\nDate: ${date}\nDigest: ${digest}`;
}

export function signText(signer, text) {
  const hash = HASH[signer.algorithm];
  // DER-encoded ECDSA signatures match what Starling's Java samples produce.
  return crypto.sign(hash, Buffer.from(text, 'utf8'), { key: signer.key, dsaEncoding: 'der' }).toString('base64');
}

// Returns the headers a signed request needs on top of the bearer token.
export function signedHeaders(signer, { token, method, target, bodyBuffer, now = new Date() }) {
  const date = now.toISOString();
  const digest = digestOf(bodyBuffer);
  const signature = signText(signer, signingString({ method, target, date, digest }));
  return {
    Authorization: `Bearer ${token};Signature keyid="${signer.keyUid}",algorithm="${signer.algorithm}",headers="(request-target) Date Digest",signature="${signature}"`,
    Date: date,
    Digest: digest,
  };
}

// Sign-then-verify with the matching public key: proves the key works without calling the API.
export function selfTest(signer) {
  const text = signingString({ method: 'put', target: '/self-test', date: new Date().toISOString(), digest: digestOf(Buffer.from('{}')) });
  const sig = signText(signer, text);
  const pub = crypto.createPublicKey(signer.key);
  return crypto.verify(HASH[signer.algorithm], Buffer.from(text), { key: pub, dsaEncoding: 'der' }, Buffer.from(sig, 'base64'));
}
