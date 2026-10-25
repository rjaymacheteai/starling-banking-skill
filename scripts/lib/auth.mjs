import { loadToken } from './config.mjs';
import { StarlingClient } from './client.mjs';
import { getOperation } from './catalogue.mjs';
import { CliError } from './errors.mjs';

export const isPaymentInitiation = (op) => op.operationId === 'makeLocalPayment';

export function assertPaymentIdentity(account, payment) {
  if (!account?.accountHolderUid || !payment?.accountHolderUid) {
    throw new CliError('PAYMENT_IDENTITY_UNVERIFIED', 'Could not verify that both tokens belong to the same Starling account holder.', { hint: 'Run `doctor` and check both tokens. No payment will be initiated until their holder identities can be verified.' });
  }
  if (account.accountHolderUid !== payment.accountHolderUid) {
    throw new CliError('PAYMENT_TOKEN_MISMATCH', 'The payment token belongs to a different account holder.', { hint: 'Replace only the payment token with one for the same holder as the account token, then run `doctor`. Account reads remain available.' });
  }
  if (!payment.scopes?.includes('pay-local:create')) {
    throw new CliError('PAYMENT_SCOPE_MISSING', 'The payment token cannot initiate payments: pay-local:create is missing.', { hint: 'Create a payment token with pay-local:create for this account holder. Keep the account token separate; do not add payment scopes to it.' });
  }
}

// One routing boundary for friendly commands, generic calls and confirmation.
// Only initiation uses the payment token; reads/status/cancellations use account.
export class RoutedClient {
  constructor({ config, env, retryDelayMs }) {
    this.config = config;
    this.env = env;
    this.retryDelayMs = retryDelayMs;
    this.account = new StarlingClient({ config, env, retryDelayMs, ...loadToken(config, env), tokenRole: 'account' });
  }
  get signer() { return this.account.signer; }
  async ensurePayment() {
    if (!this.ready) this.ready = this.checkPayment();
    await this.ready;
  }
  async checkPayment() {
    this.payment = new StarlingClient({ config: this.config, env: this.env, retryDelayMs: this.retryDelayMs, ...loadToken(this.config, this.env, 'payments'), tokenRole: 'payments' });
    const op = getOperation('getTokenIdentity');
    const account = (await this.account.call(op)).data;
    const payment = (await this.payment.call(op)).data;
    assertPaymentIdentity(account, payment);
    // Validate locally before a preview is created; Starling verifies key registration on submission.
    void this.payment.signer;
  }
  async call(op, request) {
    if (isPaymentInitiation(op)) { await this.ensurePayment(); return this.payment.call(op, request); }
    return this.account.call(op, request);
  }
}
