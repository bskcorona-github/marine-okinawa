import 'server-only';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { db } from '@/db';
import { operatorMembers, operators, shopMembers } from '@/db/schema';
import { auth } from '@/lib/auth';
import { evaluateAccess, HOME_OF, type Role } from './access';

export type AdminContext = { userId: string; email: string; shopId: string; role: 'admin' };
export type OperatorContext = { userId: string; email: string; shopId: string; operatorId: string; role: 'operator' };

/** ログイン中の利用者と、その種類（組合の管理者か、停止されていない事業者アカウントか） */
const loadState = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { session: null, role: null, shopId: null, operatorId: null, passwordChangeRequired: false };
  const [member] = await db.select().from(shopMembers).where(eq(shopMembers.userId, session.user.id)).limit(1);
  if (member) {
    return { session, role: 'admin' as Role, shopId: member.shopId, operatorId: null, passwordChangeRequired: false };
  }
  // 停止中の事業者（取引の停止）のアカウントは、アカウントごとの停止と同じく入れない
  const [operator] = await db
    .select({
      shopId: operatorMembers.shopId,
      operatorId: operatorMembers.operatorId,
      passwordChangeRequired: operatorMembers.passwordChangeRequired,
    })
    .from(operatorMembers)
    .innerJoin(operators, eq(operators.id, operatorMembers.operatorId))
    .where(
      and(
        eq(operatorMembers.userId, session.user.id),
        isNull(operatorMembers.disabledAt),
        ne(operators.status, 'suspended'),
      ),
    )
    .limit(1);
  if (operator) {
    return {
      session,
      role: 'operator' as Role,
      shopId: operator.shopId,
      operatorId: operator.operatorId,
      passwordChangeRequired: operator.passwordChangeRequired,
    };
  }
  return { session, role: null, shopId: null, operatorId: null, passwordChangeRequired: false };
});

async function requireRole(required: Role) {
  const state = await loadState();
  const access = evaluateAccess({
    hasSession: Boolean(state.session),
    role: state.role,
    twoFactorEnabled: Boolean(state.session?.user.twoFactorEnabled),
    required,
  });
  // ログインはできているが、組合の管理者でも有効な事業者アカウントでもない（停止中など）
  if (access === 'login') redirect(state.session ? '/admin/login?reason=no_access' : '/admin/login');
  if (access === 'other_role') redirect(HOME_OF[state.role!]);
  if (access === 'setup_2fa') redirect('/admin/2fa/setup');
  return state as typeof state & { session: NonNullable<typeof state.session>; shopId: string };
}

/** 管理画面のページ・Server Action の先頭で必ず呼ぶ（組合の管理者だけ） */
export async function requireAdmin(): Promise<AdminContext> {
  const state = await requireRole('admin');
  return { userId: state.session.user.id, email: state.session.user.email, shopId: state.shopId, role: 'admin' };
}

/**
 * 事業者画面のページ・Server Action の先頭で必ず呼ぶ（停止されていない事業者アカウントだけ）。
 * 仮パスワードのままなら、パスワードの変更へ進めてから使ってもらう
 */
export async function requireOperator(): Promise<OperatorContext> {
  const state = await requireRole('operator');
  if (state.passwordChangeRequired) redirect('/partner/password');
  return {
    userId: state.session.user.id,
    email: state.session.user.email,
    shopId: state.shopId,
    operatorId: state.operatorId!,
    role: 'operator',
  };
}

/** パスワードの変更画面用（仮パスワードのままでも通す。2 要素認証は設定済みであること） */
export async function requireOperatorForPasswordChange(): Promise<{ email: string; required: boolean }> {
  const state = await requireRole('operator');
  return { email: state.session.user.email, required: state.passwordChangeRequired };
}

/** 2 要素認証の設定画面用（管理者・事業者どちらも、設定前でも通す）。設定後の行き先も返す */
export async function requirePending2fa(): Promise<{ email: string; twoFactorEnabled: boolean; home: string }> {
  const state = await loadState();
  if (!state.session || !state.role) redirect('/admin/login');
  return {
    email: state.session.user.email,
    twoFactorEnabled: Boolean(state.session.user.twoFactorEnabled),
    home: HOME_OF[state.role],
  };
}
