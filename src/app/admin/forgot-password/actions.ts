'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import { requestLoginHelp } from '@/modules/auth/login-help';
import { isFeatureOn } from '@/modules/shop/features';
import { getCurrentShop } from '@/modules/shop/shops';

/** 「ログインできないとき」。登録の有無にかかわらず、同じ画面に進む（どのアドレスが登録されているか分からないように） */
export async function requestLoginHelpAction(formData: FormData) {
  const parsed = z
    .email()
    .max(254)
    .safeParse(String(formData.get('email') ?? '').trim());
  if (!parsed.success) redirect('/admin/forgot-password?error=email');
  // 「機能の切り替え」で止めているあいだは送らない
  if (!(await isFeatureOn(db, (await getCurrentShop(db)).id, 'auth.login_help')))
    redirect('/admin/forgot-password?paused=1');
  await requestLoginHelp(db, { email: parsed.data, headers: await headers() });
  redirect('/admin/forgot-password?sent=1');
}
