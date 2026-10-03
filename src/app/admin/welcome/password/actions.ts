'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import { auth } from '@/lib/auth';
import { requireLoginSetup } from '@/modules/auth/guard';
import { markPasswordChanged } from '@/modules/partner/accounts';

export type SetPasswordState = { error: string | null };

const schema = z
  .object({ password: z.string().min(12).max(128), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'] });

/**
 * 招待のリンクから入った人が、はじめてパスワードを決める（パスワードがまだないときだけ）。
 * 決めたら、認証アプリ（2 要素認証）の設定へ進む
 */
export async function setInitialPasswordAction(_prev: SetPasswordState, formData: FormData): Promise<SetPasswordState> {
  const me = await requireLoginSetup();
  if (me.hasPassword) redirect('/admin/2fa/setup');
  const parsed = schema.safeParse({ password: formData.get('password'), confirm: formData.get('confirm') });
  if (!parsed.success) {
    return {
      error: parsed.error.issues.some((i) => i.path[0] === 'confirm')
        ? '確認用のパスワードが一致しません'
        : 'パスワードは 12 文字以上（128 文字まで）にしてください',
    };
  }
  const ctx = await auth.$context;
  await ctx.internalAdapter.linkAccount({
    userId: me.userId,
    providerId: 'credential',
    accountId: me.userId,
    password: await ctx.password.hash(parsed.data.password),
  });
  await markPasswordChanged(db, me.userId);
  redirect('/admin/2fa/setup');
}
