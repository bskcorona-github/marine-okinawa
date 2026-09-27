import { parsePhoneNumberFromString } from 'libphonenumber-js';

export function normalizeEmail(input?: string | null): string | null {
  const value = input?.trim().toLowerCase();
  return value ? value : null;
}

/** 電話番号を E.164 にする。国番号がなければ日本の番号とみなす。無効なら null */
export function normalizePhone(input?: string | null): string | null {
  const value = input?.trim();
  if (!value) return null;
  const phone = parsePhoneNumberFromString(value, 'JP');
  return phone?.isValid() ? phone.number : null;
}
