import { auth } from '@/lib/auth';
import { logError } from '@/lib/log';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { twoFactor, user } from '@/db/schema';
import type { CreateCredentialUser, ResetCredential } from './accounts';

/** Better Auth でメールとパスワードでログインできるユーザーを作る（パスワードのハッシュ形式を合わせるため） */
export const createCredentialUser: CreateCredentialUser = async ({ email, name, password }) => {
  const ctx = await auth.$context;
  const created = await ctx.internalAdapter.createUser({ email, name, emailVerified: true }, { method: 'admin' });
  try {
    await ctx.internalAdapter.linkAccount({
      userId: created.id,
      providerId: 'credential',
      accountId: created.id,
      password: await ctx.password.hash(password),
    });
  } catch (error) {
    // パスワードを結びつけられなかった：作ったユーザーを消す（ログインできないユーザーで、メールアドレスを塞がないように）
    await ctx.internalAdapter
      .deleteUser(created.id)
      .catch((removeError) => logError('operator.account.orphan_remove_failed', { userId: created.id }, removeError));
    throw error;
  }
  return created.id;
};

/**
 * パスワードを置き換え、ログイン中のセッションと 2 要素認証の設定を消す（仮パスワードの再発行）。
 * 次のログインで、2 要素認証の設定からやり直してもらう
 */
export const resetCredential: ResetCredential = async ({ userId, password }) => {
  const ctx = await auth.$context;
  await ctx.internalAdapter.updatePassword(userId, await ctx.password.hash(password));
  await ctx.internalAdapter.deleteUserSessions(userId);
  await db.transaction(async (tx) => {
    await tx.delete(twoFactor).where(eq(twoFactor.userId, userId));
    await tx.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, userId));
  });
};
