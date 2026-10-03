import 'server-only';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { db } from '@/db';
import { account, operatorMembers, operators, shopMembers } from '@/db/schema';
import { isSocialProvider } from '@/lib/social-providers';
import { auth } from '@/lib/auth';
import { evaluateAccess, HOME_OF, type Role } from './access';
import { isFeatureOn } from '@/modules/shop/features';

export type AdminContext = {
  userId: string;
  email: string;
  shopId: string;
  role: 'admin';
  /**
   * 「機能の切り替え」で 2 要素認証を止めていなくても入れる人か（認証アプリを設定済み、または LINE・Google だけ）。
   * 守りに関わる機能を止められるのはこの人だけ（止めたおかげで入れている人が、止め続けられないように）
   */
  strongAuth: boolean;
};
export type OperatorContext = { userId: string; email: string; shopId: string; operatorId: string; role: 'operator' };

/** ログイン中の利用者と、その種類（組合の管理者か、停止されていない事業者アカウントか） */
const loadState = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return {
      session: null,
      role: null,
      shopId: null,
      operatorId: null,
      passwordChangeRequired: false,
      hasPassword: false,
      hasSocialLogin: false,
    };
  }
  // ログインに使える方法（パスワード・つないだ LINE / Google）
  const methods = await db
    .select({ providerId: account.providerId })
    .from(account)
    .where(eq(account.userId, session.user.id));
  const login = {
    hasPassword: methods.some((m) => m.providerId === 'credential'),
    hasSocialLogin: methods.some((m) => isSocialProvider(m.providerId)),
  };
  const [member] = await db.select().from(shopMembers).where(eq(shopMembers.userId, session.user.id)).limit(1);
  if (member) {
    return {
      session,
      role: 'admin' as Role,
      shopId: member.shopId,
      operatorId: null,
      passwordChangeRequired: false,
      ...login,
    };
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
      ...login,
    };
  }
  return { session, role: null, shopId: null, operatorId: null, passwordChangeRequired: false, ...login };
});

async function requireRole(required: Role) {
  const state = await loadState();
  // 「機能の切り替え」：事業者画面を止めているあいだは、事業者は入れない
  if (required === 'operator' && state.role === 'operator' && state.shopId) {
    if (!(await isFeatureOn(db, state.shopId, 'partner.portal'))) redirect('/admin/login?reason=partner_paused');
  }
  const twoFactorRequired = state.shopId ? await isFeatureOn(db, state.shopId, 'auth.two_factor_required') : true;
  const access = evaluateAccess({
    hasSession: Boolean(state.session),
    role: state.role,
    twoFactorEnabled: Boolean(state.session?.user.twoFactorEnabled),
    hasSocialLogin: state.hasSocialLogin,
    hasPassword: state.hasPassword,
    twoFactorRequired,
    required,
  });
  // ログインはできているが、組合の管理者でも有効な事業者アカウントでもない（停止中など）
  if (access === 'login') redirect(state.session ? '/admin/login?reason=no_access' : '/admin/login');
  if (access === 'other_role') redirect(HOME_OF[state.role!]);
  if (access === 'setup_2fa') redirect('/admin/2fa/setup');
  if (access === 'setup_login') redirect('/admin/welcome/setup');
  return state as typeof state & { session: NonNullable<typeof state.session>; shopId: string };
}

/** 管理画面のページ・Server Action の先頭で必ず呼ぶ（組合の管理者だけ） */
export async function requireAdmin(): Promise<AdminContext> {
  const state = await requireRole('admin');
  const strongAuth =
    evaluateAccess({
      hasSession: true,
      role: 'admin',
      twoFactorEnabled: Boolean(state.session.user.twoFactorEnabled),
      hasSocialLogin: state.hasSocialLogin,
      hasPassword: state.hasPassword,
      twoFactorRequired: true,
      required: 'admin',
    }) === 'ok';
  return {
    userId: state.session.user.id,
    email: state.session.user.email,
    shopId: state.shopId,
    role: 'admin',
    strongAuth,
  };
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

/**
 * 招待のリンクから入ったあと、ログインの方法を決める画面用（LINE・Google をつなぐか、パスワードを決める）。
 * すでに決めている人は、それぞれのトップへ戻す
 */
export async function requireLoginSetup(): Promise<{
  userId: string;
  email: string;
  home: string;
  hasPassword: boolean;
}> {
  const state = await loadState();
  if (!state.session || !state.role) redirect('/admin/login');
  const home = HOME_OF[state.role];
  if (state.hasSocialLogin || state.session.user.twoFactorEnabled) redirect(home);
  return { userId: state.session.user.id, email: state.session.user.email, home, hasPassword: state.hasPassword };
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
