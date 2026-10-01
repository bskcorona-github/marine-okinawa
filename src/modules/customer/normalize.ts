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

/** 保存済みの電話番号（E.164）を画面表示用の国内形式にする（例：+819012345678 → 090-1234-5678） */
export function formatPhoneForDisplay(value?: string | null): string {
  if (!value) return '';
  const phone = parsePhoneNumberFromString(value, 'JP');
  if (!phone) return value;
  return phone.country === 'JP' ? phone.formatNational() : phone.formatInternational();
}
