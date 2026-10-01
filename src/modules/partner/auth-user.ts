import { auth } from '@/lib/auth';
import type { CreateCredentialUser } from './accounts';

/** Better Auth でメールとパスワードでログインできるユーザーを作る（パスワードのハッシュ形式を合わせるため） */
export const createCredentialUser: CreateCredentialUser = async ({ email, name, password }) => {
  const ctx = await auth.$context;
  const created = await ctx.internalAdapter.createUser({ email, name, emailVerified: true }, { method: 'admin' });
  await ctx.internalAdapter.linkAccount({
    userId: created.id,
    providerId: 'credential',
    accountId: created.id,
    password: await ctx.password.hash(password),
  });
  return created.id;
};
