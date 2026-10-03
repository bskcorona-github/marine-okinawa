/** ログインできる利用者の種類。admin：組合・カネマサの管理者、operator：実施事業者 */
export type Role = 'admin' | 'operator';

/**
 * other_role：ログインはできているが、別の種類の画面の利用者（事業者が管理画面を開いたなど）。
 * setup_2fa：パスワードはあるが認証アプリが未設定。setup_login：招待のリンクから入ったが、まだログインの方法を決めていない
 */
export type Access = 'ok' | 'login' | 'setup_2fa' | 'setup_login' | 'other_role';

/**
 * 画面に入れるかの判定。管理者は組合のメンバー、事業者は有効な事業者アカウント。
 * パスワードでログインする人は 2 要素認証が必須。LINE・Google をつないだ人は、その本人確認で入れる。
 * 権限はここ（サーバー側）で判定し、画面の表示だけに頼らない
 */
export function evaluateAccess(p: {
  hasSession: boolean;
  role: Role | null;
  twoFactorEnabled: boolean;
  /** LINE・Google をつないでいる */
  hasSocialLogin: boolean;
  /** パスワードを決めている */
  hasPassword: boolean;
  required: Role;
}): Access {
  if (!p.hasSession || !p.role) return 'login';
  if (p.role !== p.required) return 'other_role';
  if (p.twoFactorEnabled || p.hasSocialLogin) return 'ok';
  return p.hasPassword ? 'setup_2fa' : 'setup_login';
}

/** 利用者の種類ごとのトップ画面 */
export const HOME_OF: Record<Role, string> = { admin: '/admin', operator: '/partner' };
