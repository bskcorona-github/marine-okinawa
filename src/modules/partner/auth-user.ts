import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { account, twoFactor, user } from '@/db/schema';
import { auth } from '@/lib/auth';
import type { CreateLoginUser, ResetLoginAccess } from './accounts';

/**
 * Better Auth でログインに使うユーザーを作る（パスワードは付けない。本人が招待のリンクから LINE・Google をつなぐか、
 * パスワードを決める）。メールアドレスは組合が確かめたものとして扱う
 */
export const createLoginUser: CreateLoginUser = async ({ email, name }) => {
  const ctx = await auth.$context;
  const created = await ctx.internalAdapter.createUser({ email, name, emailVerified: true }, { method: 'admin' });
  return created.id;
};

/**
 * ログインの方法をすべて外す：パスワード・つないだ LINE / Google・2 要素認証の設定・ログイン中のセッション。
 * 次は招待のリンクからやり直してもらう
 */
export const resetLoginAccess: ResetLoginAccess = async ({ userId }) => {
  const ctx = await auth.$context;
  await ctx.internalAdapter.deleteUserSessions(userId);
  await db.transaction(async (tx) => {
    await tx.delete(account).where(eq(account.userId, userId));
    await tx.delete(twoFactor).where(eq(twoFactor.userId, userId));
    await tx.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, userId));
  });
};
