import { createHash, randomBytes } from 'node:crypto';
import type { DbOrTx } from '@/db/client';
import { bookingAccessTokens } from '@/db/schema';

const DAY_MS = 24 * 60 * 60_000;

/** ゲストが予約を確認するためのトークン。DB にはハッシュだけを保存する */
export function issueAccessToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashAccessToken(token) };
}

export function hashAccessToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 回の終了から 30 日後まで有効 */
export function accessTokenExpiry(startsAt: Date, durationMin: number): Date {
  return new Date(startsAt.getTime() + durationMin * 60_000 + 30 * DAY_MS);
}

/**
 * 予約確認ページの URL のトークンを 1 つ足す（メールを送るたびに新しいトークンを使う）。
 * 以前に送ったメールのトークンも、予約の有効期限までは使える
 */
export async function addBookingAccessToken(db: DbOrTx, bookingId: string): Promise<string> {
  const { token, hash } = issueAccessToken();
  await db.insert(bookingAccessTokens).values({ bookingId, tokenHash: hash });
  return token;
}
