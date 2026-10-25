import crypto from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, usage } from '../errors.mjs';
import { configPath, homeDir } from '../paths.mjs';

const EXAMPLE = new URL('../../../config.json.example', import.meta.url);

export const setupCommands = {
  init: {
    summary: 'Create your config.json from the bundled example.',
    usage: 'init [--force]',
    options: { boolean: ['force'] },
    needsContext: false,
    async run({ env }, { flags }) {
      const target = configPath(env);
      if (existsSync(target) && !flags.force) {
        throw new CliError('FILE_EXISTS', `${target} already exists, so it was left alone.`, { hint: 'Edit it directly, or run `init --force` to replace it with the example.' });
      }
      mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      copyFileSync(EXAMPLE, target);
      return {
        created: target,
        next: [
          'Edit only the settings you need; references/configuration.md explains each field.',
          'Supply the required account token locally as STARLING_ACCESS_TOKEN or auth.account.tokenFile. It is used for everything except payment initiation; never paste it into chat.',
          'Optional: supply STARLING_PAYMENT_ACCESS_TOKEN or auth.payments.tokenFile only if you want to initiate payments. Run `doctor` to check setup.',
        ],
      };
    },
  },

  'keys generate': {
    summary: 'Create the two signing key pairs Starling needs for payments (an API key and a rotation key).',
    usage: 'keys generate [--type rsa|ecdsa] [--dir <folder>]',
    options: { string: ['type', 'dir'] },
    needsContext: false,
    async run({ env }, { flags }) {
      const type = flags.type ?? 'rsa';
      if (!['rsa', 'ecdsa'].includes(type)) throw usage('--type must be rsa or ecdsa.');
      const dir = flags.dir ?? path.join(homeDir(env), 'keys');
      const names = ['api', 'rotation'];
      const files = names.flatMap((n) => [`starling-${n}-private.key`, `starling-${n}-public.key`].map((f) => path.join(dir, f)));
      const clash = files.find((f) => existsSync(f));
      if (clash) throw new CliError('FILE_EXISTS', `${clash} already exists; keys are never overwritten.`, { hint: 'Choose another --dir.' });
      mkdirSync(dir, { recursive: true, mode: 0o700 });

      const publicKeys = {};
      for (const n of names) {
        const { publicKey, privateKey } =
          type === 'rsa'
            ? crypto.generateKeyPairSync('rsa', { modulusLength: 4096, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
            : crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1', publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
        writeFileSync(path.join(dir, `starling-${n}-private.key`), privateKey, { mode: 0o600 });
        writeFileSync(path.join(dir, `starling-${n}-public.key`), publicKey, { mode: 0o644 });
        publicKeys[n] = publicKey;
      }
      return {
        folder: dir,
        type,
        files,
        publicKeys,
        next: [
          'In the Starling developer portal, open your Personal Access page, go to Keys, and upload BOTH public keys (api first, then rotation). Public keys are safe to share; private keys never leave this computer.',
          'Copy the Key Uid that Starling shows for the API key into config.json as signing.keyUid, and set signing.keyFile to the api private key path above.',
          'Back up the rotation private key somewhere safe: without it you cannot add a replacement API key later.',
          'Run `doctor` to confirm the key works.',
        ],
      };
    },
  },
};
