import { z } from 'zod';
import type { ShopSettings } from '@/db/schema';
import { addDays, localDate, zonedToUtc } from '@/lib/dates';

export type { ShopSettings };

export const DEFAULT_SETTINGS: ShopSettings = {
  siteName: '沖縄マリンアクティビティ総合ガイド・予約サイト',
  priceLabel: 'お支払総額',
  paymentInstructions: '',
  paymentDueDays: 3,
  commonCancellationPolicy: '',
  commonWeatherPolicy: '',
  bookingPaused: false,
  bookingPausedMessage:
    'ただいま Web でのお申し込みを一時停止しています。お急ぎの方は、お問い合わせフォームからご連絡ください。',
  adminNotifyEmail: '',
  replyGuide: '',
  autoRequestOwner: true,
};

/** 管理画面から保存する値の検証（空欄にできる項目と、必ず値が要る項目を分ける） */
export const settingsSchema = z.object({
  siteName: z.string().trim().min(1).max(60),
  priceLabel: z.string().trim().min(1).max(20),
  paymentInstructions: z.string().trim().max(2000),
  paymentDueDays: z.coerce.number().int().min(1).max(30),
  commonCancellationPolicy: z.string().trim().max(3000),
  commonWeatherPolicy: z.string().trim().max(2000),
  bookingPaused: z
    .union([z.literal('on'), z.literal('true'), z.literal(''), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'on' || v === 'true'),
  bookingPausedMessage: z.string().trim().max(300),
  adminNotifyEmail: z
    .string()
    .trim()
    .max(200)
    .pipe(z.union([z.literal(''), z.email()])),
  replyGuide: z.string().trim().max(200),
  autoRequestOwner: z
    .union([z.literal('on'), z.literal('true'), z.literal(''), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'on' || v === 'true'),
});

/** 天候・海況による中止の扱い：組合共通の文面のあとに、プランごとの文面を続ける（どちらも空なら空） */
export function weatherPolicyText(common: string, plan: string | null | undefined): string {
  return [common, plan ?? '']
    .map((v) => v.trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * 保存されている設定に既定値を補う。型の合わない値（古い形式・手で書き換えた値）は捨てて既定値を使う
 * （設定の不備でサイトが表示できなくならないようにする）
 */
export function resolveSettings(raw: Partial<ShopSettings> | null | undefined): ShopSettings {
  const result: ShopSettings = { ...DEFAULT_SETTINGS };
  if (!raw) return result;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof ShopSettings)[]) {
    const value = raw[key];
    if (value === undefined || typeof value !== typeof DEFAULT_SETTINGS[key]) continue;
    const parsed = settingsSchema.shape[key].safeParse(value);
    if (parsed.success) (result as Record<string, unknown>)[key] = parsed.data;
  }
  return result;
}

/**
 * 支払期限。支払待ちにした日から paymentDueDays 日後の 23:59（ショップのタイムゾーン）。
 * ただし参加日の前日 23:59 を超えない。前日を過ぎている（当日・翌日の申込など）ときは開始時刻を期限にする
 */
export function paymentDueAt(params: { now: Date; startsAt: Date; days: number; timezone: string }): Date {
  const { now, startsAt, days, timezone } = params;
  const endOfDay = (date: string) => new Date(zonedToUtc(addDays(date, 1), '00:00', timezone).getTime() - 60_000);
  const byDays = endOfDay(addDays(localDate(now, timezone), days));
  const dayBefore = endOfDay(addDays(localDate(startsAt, timezone), -1));
  const due = byDays < dayBefore ? byDays : dayBefore;
  return due > now ? due : startsAt;
}
