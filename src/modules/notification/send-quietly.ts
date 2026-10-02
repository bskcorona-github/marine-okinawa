import { getEnv } from '@/lib/env';
import { logError, type LogFields } from '@/lib/log';
import { getMailer, type Mailer } from './mailer';

/**
 * 操作のあとのメール。準備（getMailer・getEnv）から送信までのどこで失敗しても例外を投げず、ログに残して
 * { status: 'failed' } を返す（保存は済んでいるので、画面をエラーにしない。再送信による二重登録を防ぐ）。
 * event はログのイベント名（例：mail.booking.failed）
 */
export async function sendQuietly<T>(
  event: string,
  fields: LogFields,
  send: (mailer: Mailer, appUrl: string) => Promise<T>,
): Promise<T | { status: 'failed' }> {
  try {
    return await send(getMailer(), getEnv().APP_URL);
  } catch (error) {
    logError(event, fields, error);
    return { status: 'failed' };
  }
}
