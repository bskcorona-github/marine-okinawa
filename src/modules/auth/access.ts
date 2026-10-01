/** ログインできる利用者の種類。admin：組合・カネマサの管理者、operator：実施事業者 */
export type Role = 'admin' | 'operator';

/** other_role：ログインはできているが、別の種類の画面の利用者（事業者が管理画面を開いたなど） */
export type Access = 'ok' | 'login' | 'setup_2fa' | 'other_role';

/**
 * 画面に入れるかの判定。管理者は組合のメンバー、事業者は有効な事業者アカウントで、どちらも 2 要素認証を必須にする。
 * 権限はここ（サーバー側）で判定し、画面の表示だけに頼らない
 */
export function evaluateAccess(p: {
  hasSession: boolean;
  role: Role | null;
  twoFactorEnabled: boolean;
  required: Role;
}): Access {
  if (!p.hasSession || !p.role) return 'login';
  if (p.role !== p.required) return 'other_role';
  if (!p.twoFactorEnabled) return 'setup_2fa';
  return 'ok';
}

/** 利用者の種類ごとのトップ画面 */
export const HOME_OF: Record<Role, string> = { admin: '/admin', operator: '/partner' };
