import { usage } from './errors.mjs';

const SYMBOLS = { GBP: '£', EUR: '€', USD: '$' };

// Money is handled as integer minor units (pence) everywhere to avoid float errors.
export function parseAmount(text) {
  const s = String(text).trim().replace(/^[£€$]/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    throw usage(`"${text}" is not a valid amount`, 'Use a positive number with at most 2 decimal places, e.g. 25 or 25.50.');
  }
  const [whole, frac = ''] = s.split('.');
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor) || minor <= 0) throw usage(`Amount must be greater than zero (got "${text}")`);
  return minor;
}

export function formatMoney(minorUnits, currency = 'GBP') {
  const sign = minorUnits < 0 ? '-' : '';
  const abs = Math.abs(minorUnits);
  const major = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  const withCommas = major.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sym = SYMBOLS[currency];
  return sym ? `${sign}${sym}${withCommas}` : `${sign}${withCommas} ${currency}`;
}
