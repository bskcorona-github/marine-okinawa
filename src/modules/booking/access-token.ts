import { createHash, randomBytes } from 'node:crypto';

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
