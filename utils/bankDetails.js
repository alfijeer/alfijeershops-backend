'use strict';
// A seller's bank details. Pure functions (no database), shared by registration, the settings page and the order flow.
// The account number must be a 10 digit Nigerian bank account number (NUBAN).

const MESSAGE = 'Complete your payment details before accepting customer orders.';

const squash = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

// Returns { ok: true, value: { bankName, accountName, accountNumber } } or { ok: false, message }.
function cleanBankDetails(input) {
  const src = input || {};
  const bankName = squash(src.bankName);
  const accountName = squash(src.accountName);
  const accountNumber = String(src.accountNumber == null ? '' : src.accountNumber).replace(/[\s-]/g, '');

  if (bankName.length < 2 || bankName.length > 60) return { ok: false, message: 'Please choose or enter your bank name.' };
  if (accountName.length < 2 || accountName.length > 80) return { ok: false, message: 'Please enter the account name exactly as it appears on your bank account.' };
  if (!/^\d{10}$/.test(accountNumber)) return { ok: false, message: 'Account number must be exactly 10 digits.' };
  return { ok: true, value: { bankName, accountName, accountNumber } };
}

// True when a stored Seller.bankDetails value is complete and valid.
const isBankComplete = (b) => !!b && cleanBankDetails(b).ok;

// True when the request carries any bank field at all (used by the settings page, where it is optional to touch them).
const hasBankFields = (body) => !!body && ['bankName', 'accountName', 'accountNumber'].some((k) => body[k] !== undefined);

module.exports = { cleanBankDetails, isBankComplete, hasBankFields, BANK_REQUIRED_MESSAGE: MESSAGE };
