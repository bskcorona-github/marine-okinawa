import 'server-only';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { db } from '@/db';
import { shopMembers } from '@/db/schema';
import { auth } from '@/lib/auth';
import { evaluateAdminAccess } from './access';

export type AdminContext = { userId: string; email: string; shopId: string; role: 'admin' };

const loadAdminState = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() });
  const [member] = session
    ? await db.select().from(shopMembers).where(eq(shopMembers.userId, session.user.id)).limit(1)
    : [];
  const access = evaluateAdminAccess({
    hasSession: Boolean(session),
    isMember: Boolean(member),
    twoFactorEnabled: Boolean(session?.user.twoFactorEnabled),
  });
  return { session, member, access };
});

/** 管理画面のページ・Server Action の先頭で必ず呼ぶ */
export async function requireAdmin(): Promise<AdminContext> {
  const { session, member, access } = await loadAdminState();
  if (access === 'login') redirect('/admin/login');
  if (access === 'setup_2fa') redirect('/admin/2fa/setup');
  return { userId: session!.user.id, email: session!.user.email, shopId: member!.shopId, role: member!.role };
}

/** 2 要素認証の設定画面用（メンバーであれば未設定でも通す） */
export async function requireAdminPending2fa(): Promise<{ email: string; twoFactorEnabled: boolean }> {
  const { session, access } = await loadAdminState();
  if (access === 'login') redirect('/admin/login');
  return { email: session!.user.email, twoFactorEnabled: Boolean(session!.user.twoFactorEnabled) };
}
