import { randomInt } from 'node:crypto';

// 0/O, 1/I/L など読み間違えやすい文字を除く
export const BOOKING_NO_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateBookingNo(): string {
  let value = '';
  for (let i = 0; i < 8; i++) value += BOOKING_NO_ALPHABET[randomInt(BOOKING_NO_ALPHABET.length)];
  return value;
}
