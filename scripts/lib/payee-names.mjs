import { CliError, usage } from './errors.mjs';

export const NAME_FLAGS = ['name', 'display-name', 'first-name', 'middle-name', 'last-name', 'business-name'];
export const NAME_FIELDS = { 'first-name': 'firstName', 'middle-name': 'middleName', 'last-name': 'lastName', 'business-name': 'businessName' };

function text(value, flag) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 255) {
    throw usage(`--${flag} must contain between 1 and 255 characters.`);
  }
  return value.trim();
}

export function suppliedRecipientName(payee) {
  return payee.payeeType === 'BUSINESS'
    ? payee.businessName || null
    : [payee.firstName, payee.middleName, payee.lastName].filter(Boolean).join(' ') || null;
}

// Optional identity fields are only copied from explicit input, never inferred from a label.
export function payeeNameChanges(flags, type) {
  const changes = {};
  if (flags.name !== undefined && flags['display-name'] !== undefined && flags.name !== flags['display-name']) {
    throw usage('--name and --display-name refer to the same display label; provide only one.');
  }
  if (flags.name !== undefined || flags['display-name'] !== undefined) {
    changes.payeeName = text(flags['display-name'] ?? flags.name, 'display-name');
  }
  for (const [flag, field] of Object.entries(NAME_FIELDS)) {
    if (flags[flag] === undefined) continue;
    if ((type === 'BUSINESS') !== (field === 'businessName')) {
      throw usage(type === 'BUSINESS' ? 'Use --business-name for a business payee.' : '--business-name requires --type business.');
    }
    changes[field] = text(flags[flag], flag);
  }
  return changes;
}

export function namePreview(payee) {
  const name = suppliedRecipientName(payee);
  return `${name ? `Supplied recipient name: "${name}".` : 'Recipient name not supplied.'} No bank name-match result is reported by this API.`;
}

// updatePayee uses PUT. Preserve other editable personal fields when changing a label/name.
export function editablePayee(payee) {
  const fields = ['payeeName', 'payeeType', 'phoneNumber', 'firstName', 'middleName', 'lastName', 'businessName', 'dateOfBirth'];
  const accountFields = ['description', 'defaultAccount', 'countryCode', 'accountIdentifier', 'bankIdentifier', 'bankIdentifierType', 'secondaryIdentifier'];
  const required = accountFields.filter((key) => key !== 'secondaryIdentifier');
  if (!Array.isArray(payee.accounts) || !payee.accounts.length || payee.accounts.some((a) =>
    a.payeeChannelType !== 'BANK_ACCOUNT' || required.some((key) => a[key] == null))) {
    throw new CliError('PAYEE_UPDATE_UNSUPPORTED', 'Cannot safely preserve all saved accounts in this payee update.', {
      hint: 'This command supports payees whose accounts have complete bank-account details. Update this payee in the Starling app instead.',
    });
  }
  // The live API requires a nonempty accounts array even for a name-only update.
  // Copy only request-schema fields; response-only UIDs/channel fields are not sent.
  const accounts = payee.accounts.map((account) => Object.fromEntries(
    accountFields.filter((key) => account[key] != null).map((key) => [key, account[key]]),
  ));
  return { ...Object.fromEntries(fields.filter((key) => payee[key] != null).map((key) => [key, payee[key]])), accounts };
}
