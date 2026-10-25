import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { CliError, usage } from '../errors.mjs';
import { configPath } from '../paths.mjs';
import { DEFAULTS, loadConfig, saveConfig } from '../config.mjs';
import { resolveAlgorithm } from '../signing.mjs';

export const setupCommands = {
  init: {
    summary: 'Create one private config.json for credentials and settings.',
    usage: 'init',
    options: {},
    needsContext: false,
    async run({ env }) {
      const file = configPath(env);
      if (existsSync(file)) throw new CliError('FILE_EXISTS', `${file} already exists and was left untouched.`, { hint: 'Edit the existing file locally. Never paste its secret contents into chat.' });
      saveConfig(file, structuredClone(DEFAULTS));
      return { created: file, next: ['Fill auth.accountToken locally. auth.paymentToken is optional for initiating payments.', 'For requested signing setup, run `keys generate`; it saves the private key directly in this config.', 'Run `doctor`; never send the config or secret values to the agent.'] };
    },
  },
  'keys generate': {
    summary: 'Generate an API signing pair; save only its private key in config.json and show the public key.',
    usage: 'keys generate [--type rsa|ecdsa]',
    options: { string: ['type'] },
    needsContext: false,
    async run({ env }, { flags }) {
      const type = flags.type ?? 'rsa';
      if (!['rsa', 'ecdsa'].includes(type)) throw usage('--type must be rsa or ecdsa.');
      const { config, file } = loadConfig(env);
      if (config.signing.privateKey || config.signing.keyUid) throw new CliError('FILE_EXISTS', 'Existing signing setup was left untouched.', { hint: 'Key replacement/rotation is deferred; see references/decisions-and-limitations.md (R01).' });
      const encoding = { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } };
      const { privateKey, publicKey } = type === 'rsa'
        ? crypto.generateKeyPairSync('rsa', { modulusLength: 4096, ...encoding })
        : crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1', ...encoding });
      config.signing.privateKey = privateKey;
      saveConfig(file, config);
      return { updated: file, type, publicKeys: { api: publicKey }, next: ['Register only this public API key in Starling. The private key is already stored in local config.json and must never be shared.', 'Copy the registered API Key UID into signing.keyUid in config.json. It is required in the signature keyid header.', 'If the portal requires rotation-key registration or an upload signature, stop: see references/decisions-and-limitations.md (R01).', 'Run `doctor` for a local key test; Starling verifies registration on a signed request.'] };
    },
  },
  'keys public': {
    summary: 'Show the public API key derived from the private key in local config.json.',
    usage: 'keys public',
    options: {},
    needsContext: false,
    async run({ env }) {
      const { config } = loadConfig(env);
      if (!config.signing.privateKey) throw new CliError('SIGNING_NOT_CONFIGURED', 'No API private key is stored in config.json.', { hint: 'Request signing setup with `keys generate` first.' });
      let privateKey;
      try { privateKey = crypto.createPrivateKey(config.signing.privateKey); }
      catch { throw new CliError('SIGNING_KEY_INVALID', 'The configured private key is not valid PEM.'); }
      resolveAlgorithm(privateKey, config.signing.algorithm);
      return { publicKeys: { api: crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }) } };
    },
  },
};
