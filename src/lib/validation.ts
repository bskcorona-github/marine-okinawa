import { z } from 'zod';

const uuidSchema = z.uuid();

export function isUuid(value: unknown): value is string {
  return uuidSchema.safeParse(value).success;
}

export function isDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  // 2026-02-30 のような存在しない日付は Date が繰り上げるので、往復して一致するかで判定する
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isMonthString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
