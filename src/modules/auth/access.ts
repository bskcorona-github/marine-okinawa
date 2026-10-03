/** ログインできる利用者の種類。admin：組合・カネマサの管理者、operator：実施事業者 */
export type Role = 'admin' | 'operator';

/**
 * other_role：ログインはできているが、別の種類の画面の利用者（事業者が管理画面を開いたなど）。
 * setup_2fa：パスワードはあるが認証アプリが未設定。setup_login：招待のリンクから入ったが、まだログインの方法を決めていない
 */
export type Access = 'ok' | 'login' | 'setup_2fa' | 'setup_login' | 'other_role';

/**
 * 画面に入れるかの判定。管理者は組合のメンバー、事業者は有効な事業者アカウント。
 * パスワードを決めている人は、認証アプリ（2 要素認証）が必須（LINE・Google をつないでいても。つないだだけで
 * パスワードのログインから認証アプリを外せないように）。パスワードがなく LINE・Google だけの人は、その本人確認で入れる。
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
  /** パスワードの人に 2 要素認証を求める（「機能の切り替え」で一時的に止められる。省略時は求める） */
  twoFactorRequired?: boolean;
  required: Role;
}): Access {
  if (!p.hasSession || !p.role) return 'login';
  if (p.role !== p.required) return 'other_role';
  if (p.twoFactorEnabled) return 'ok';
  if (!p.hasPassword) return p.hasSocialLogin ? 'ok' : 'setup_login';
  return p.twoFactorRequired === false ? 'ok' : 'setup_2fa';
}

/** 利用者の種類ごとのトップ画面 */
export const HOME_OF: Record<Role, string> = { admin: '/admin', operator: '/partner' };
