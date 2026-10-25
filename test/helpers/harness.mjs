import crypto from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../../scripts/lib/cli.mjs';
import { clearSecrets } from '../../scripts/lib/redact.mjs';
import { IDS, TOKEN, PAYMENT_TOKEN, startMock } from './mock-starling.mjs';

// Builds an isolated world for one test: a temp config folder, signing keys, a mock
// Starling server and an env that points the CLI at them. Nothing touches the real home.
export async function setup({ limits, signing = false, keyType = 'rsa', mock: mockOptions = {}, config: configExtra = {}, writeConfig = true, paymentToken = signing && limits ? PAYMENT_TOKEN : '' } = {}) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'sbs-test-'));
  mkdirSync(path.join(home, 'keys'), { recursive: true });
  const gen = keyType === 'rsa'
    ? crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
    : crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1', publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const keyFile = path.join(home, 'keys', 'api-private.key');
  writeFileSync(keyFile, gen.privateKey, { mode: 0o600 });

  const mock = await startMock({ publicKeys: { [IDS.keyUid]: gen.publicKey }, ...mockOptions });
  const config = {
    environment: 'live',
    ...(signing ? { signing: { keyUid: IDS.keyUid, keyFile } } : {}),
    ...(limits ? { limits } : {}),
    ...configExtra,
  };
  const configPath = path.join(home, 'config.json');
  if (writeConfig) writeFileSync(configPath, JSON.stringify(config, null, 2));

  const env = {
    PATH: process.env.PATH,
    STARLING_BANKING_HOME: home,
    STARLING_ACCESS_TOKEN: TOKEN,
    STARLING_PAYMENT_ACCESS_TOKEN: paymentToken,
    STARLING_BANKING_TEST_BASE_URL: mock.url,
    STARLING_BANKING_RETRY_DELAY_MS: '0',
  };

  const run = async (...argv) => {
    const { stdout, exitCode } = await main(argv, env);
    // Every command in every test doubles as a leak check: no output may ever contain a secret.
    for (const secret of [TOKEN, PAYMENT_TOKEN, paymentToken, 'testSECRETpart99', 'BEGIN PRIVATE KEY', gen.privateKey.split('\n')[1]]) {
      if (secret && stdout.includes(secret)) throw new Error(`SECRET LEAKED in output of "${argv.join(' ')}": contains ${secret.slice(0, 12)}…`);
    }
    let json;
    try {
      json = JSON.parse(stdout);
    } catch {
      json = undefined;
    }
    return { stdout, json, exitCode, data: json?.data, error: json?.error };
  };

  return {
    home, env, mock, keyFile, configPath, publicKey: gen.publicKey, run,
    writeConfig: (obj) => writeFileSync(configPath, JSON.stringify(obj, null, 2)),
    async cleanup() {
      await mock.close();
      rmSync(home, { recursive: true, force: true });
      clearSecrets();
    },
  };
}

export const PAYMENT_LIMITS = { currency: 'GBP', perPayment: 50, perDay: 100 };
export { IDS, TOKEN, PAYMENT_TOKEN };
