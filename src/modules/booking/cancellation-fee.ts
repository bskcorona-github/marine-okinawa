import { createTranslator } from 'next-intl';
import { localDate } from '@/lib/dates';
import messages from '@/messages/ja.json';
import type { ShopSettings } from '@/modules/shop/settings';

/** キャンセル料と天候中止の返金率（設定の値。申込のときの値は予約の policySnapshot に残す） */
export type FeeSettings = Pick<
  ShopSettings,
  'cancelFreeDays' | 'cancelMidPercent' | 'cancelSameDayPercent' | 'weatherRefundPercent'
>;

const FEE_KEYS = ['cancelFreeDays', 'cancelMidPercent', 'cancelSameDayPercent', 'weatherRefundPercent'] as const;

/** 申込のときに残す率（policySnapshot.cancellationRates） */
export function feeSettingsOf(settings: FeeSettings): FeeSettings {
  return Object.fromEntries(FEE_KEYS.map((k) => [k, settings[k]])) as FeeSettings;
}

/**
 * その予約に使う率：申込のときに残した率（お客様が同意した規定）。古い予約で残っていなければ今の設定
 */
export function feeSettingsFor(booking: { policySnapshot: unknown; settings: FeeSettings }): FeeSettings {
  const saved = (booking.policySnapshot as { cancellationRates?: Partial<FeeSettings> } | null)?.cancellationRates;
  if (saved && FEE_KEYS.every((k) => typeof saved[k] === 'number')) return saved as FeeSettings;
  return feeSettingsOf(booking.settings);
}

/** お客様に見せるキャンセル料の規定（設定の率から作る。率と文面がずれないように） */
export function cancellationRateLines(rates: FeeSettings): string[] {
  const t = createTranslator({ locale: 'ja', messages, namespace: 'cancellationRates' });
  const lines = [t('free', { days: rates.cancelFreeDays })];
  if (rates.cancelFreeDays > 1)
    lines.push(t('mid', { from: rates.cancelFreeDays - 1, percent: rates.cancelMidPercent }));
  lines.push(t('sameDay', { percent: rates.cancelSameDayPercent }));
  lines.push(
    rates.weatherRefundPercent >= 100 ? t('weatherFull') : t('weather', { percent: rates.weatherRefundPercent }),
  );
  return lines;
}

/** 参加日の何日前か（ショップのタイムゾーンの日付で数える。当日は 0、過ぎていればマイナス） */
export function daysBeforeActivity(params: { startsAt: Date; now: Date; timezone: string }): number {
  const day = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  const activity = localDate(params.startsAt, params.timezone);
  const today = localDate(params.now, params.timezone);
  return Math.round((day(activity) - day(today)) / 86_400_000);
}

/**
 * お客様の都合の取消のキャンセル料率（%）。cancelFreeDays 日前より前は 0%、それを過ぎて前日までは cancelMidPercent、
 * 当日（と無断キャンセル）は cancelSameDayPercent
 */
export function cancellationFeePercent(settings: FeeSettings, daysBefore: number): number {
  if (daysBefore >= settings.cancelFreeDays) return 0;
  if (daysBefore >= 1) return settings.cancelMidPercent;
  return settings.cancelSameDayPercent;
}

/**
 * 取消・天候中止のときの返金予定額の初期値（予約ごとに直せる）。キャンセル料は料金にかけ（取消はキャンセル料率、
 * 天候中止は 100% − 返金率）、受け取った額から引く。二重のお支払い・追加の入金があっても、キャンセル料は料金の率の分だけ。
 * 1 円未満は切り捨て（お客様の不利にしない）。返金済みの額より少なくはしない
 */
export function suggestedRefund(params: {
  settings: FeeSettings;
  paidAmount: number;
  refundedAmount: number;
  /** 予約の料金（キャンセル料の計算のもと。受け取った額のほうが少なければ、受け取った額） */
  totalAmount: number;
  kind: 'cancelled' | 'weather_cancelled';
  startsAt: Date;
  now: Date;
  timezone: string;
}): { amount: number; feePercent: number; daysBefore: number } {
  const daysBefore = daysBeforeActivity(params);
  const feePercent =
    params.kind === 'weather_cancelled'
      ? 100 - params.settings.weatherRefundPercent
      : cancellationFeePercent(params.settings, daysBefore);
  const fee = Math.floor((Math.min(params.totalAmount, params.paidAmount) * feePercent) / 100);
  const amount = Math.max(params.refundedAmount, params.paidAmount - fee);
  return { amount: Math.min(amount, params.paidAmount), feePercent, daysBefore };
}

/**
 * 取消・天候中止の返金予定額（組合の画面の初期値と、お客様の予約確認ページからの取消で同じ計算）。
 * 一度も予約確定になっていない申込の取消は、キャンセル料をいただかず全額
 */
export function cancelRefund(
  params: Parameters<typeof suggestedRefund>[0] & { confirmedOnce: boolean },
): ReturnType<typeof suggestedRefund> {
  if (!params.confirmedOnce) {
    return { amount: params.paidAmount, feePercent: 0, daysBefore: daysBeforeActivity(params) };
  }
  return suggestedRefund(params);
}
