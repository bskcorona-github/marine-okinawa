import 'server-only';
import { randomBytes } from 'node:crypto';
import { auth } from '@/lib/auth';

/**
 * メールで送るリンク（招待・パスワードの再設定）の秘密の値。Better Auth の確認用の表（verification）に、
 * Better Auth と同じ形で入れる（招待は magic link の確認、再設定は /reset-password がそのまま使う）。
 * 発行はサーバーからだけ（外からリンクを作らせる入口は閉じている）
 */

/** 招待のリンクの有効期限（3 日） */
export const INVITE_EXPIRES_MS = 3 * 24 * 60 * 60 * 1000;
/** パスワードの再設定のリンクの有効期限（1 時間） */
export const RESET_EXPIRES_MS = 60 * 60 * 1000;

const token = (bytes: number) => randomBytes(bytes).toString('base64url');

/** 招待のリンクの値を作る（押すと、そのメールアドレスのアカウントでログインした状態になる。1 回だけ使える） */
export async function createInviteToken(email: string, name: string, now = new Date()) {
  const ctx = await auth.$context;
  const value = token(24);
  const expiresAt = new Date(now.getTime() + INVITE_EXPIRES_MS);
  await ctx.internalAdapter.createVerificationValue({
    identifier: value,
    value: JSON.stringify({ email: email.trim().toLowerCase(), name }),
    expiresAt,
  });
  return { token: value, expiresAt };
}

/** 招待のリンクがまだ使えるか（使わずに確かめる。使えるならメールアドレスを返す） */
export async function peekInviteToken(value: string, now = new Date()): Promise<{ email: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(value)) return null;
  const ctx = await auth.$context;
  const row = await ctx.internalAdapter.findVerificationValue(value);
  if (!row || row.expiresAt < now) return null;
  try {
    const parsed = JSON.parse(row.value) as { email?: unknown };
    return typeof parsed.email === 'string' ? { email: parsed.email } : null;
  } catch {
    return null;
  }
}

/**
 * パスワードの再設定のリンクが、まだ使えるか（期限内で、使っていない）。画面を開いた時点で確かめ、使えないリンクで
 * パスワードを入れさせないため（決めるときの確かめは Better Auth の /reset-password が行う）
 */
export async function peekPasswordResetToken(value: string, now = new Date()): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(value)) return false;
  const ctx = await auth.$context;
  const row = await ctx.internalAdapter.findVerificationValue(`reset-password:${value}`);
  return Boolean(row && row.expiresAt >= now);
}

/** パスワードの再設定のリンクの値を作る（/admin/reset-password で新しいパスワードを決める。1 回だけ使える） */
export async function createPasswordResetToken(userId: string, now = new Date()) {
  const ctx = await auth.$context;
  const value = token(24);
  const expiresAt = new Date(now.getTime() + RESET_EXPIRES_MS);
  await ctx.internalAdapter.createVerificationValue({
    identifier: `reset-password:${value}`,
    value: userId,
    expiresAt,
  });
  return { token: value, expiresAt };
}

export const inviteUrl = (appUrl: string, value: string) =>
  `${appUrl.replace(/\/$/, '')}/admin/welcome?token=${encodeURIComponent(value)}`;

export const passwordResetUrl = (appUrl: string, value: string) =>
  `${appUrl.replace(/\/$/, '')}/admin/reset-password?token=${encodeURIComponent(value)}`;

/** 招待のリンクから、ログインして次の画面へ進む URL（magic link の確認。期限切れ・使用済みなら招待の画面に戻す） */
export function inviteVerifyPath(value: string, next: string): string {
  const params = new URLSearchParams({
    token: value,
    callbackURL: next,
    errorCallbackURL: `/admin/welcome?token=${encodeURIComponent(value)}`,
  });
  return `/api/auth/magic-link/verify?${params}`;
}
