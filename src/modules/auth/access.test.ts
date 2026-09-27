import { describe, expect, it } from 'vitest';
import { evaluateAdminAccess } from './access';

describe('evaluateAdminAccess', () => {
  it('未ログイン・非メンバーはログインへ', () => {
    expect(evaluateAdminAccess({ hasSession: false, isMember: false, twoFactorEnabled: false })).toBe('login');
    expect(evaluateAdminAccess({ hasSession: true, isMember: false, twoFactorEnabled: true })).toBe('login');
  });

  it('2 要素認証が未設定なら設定画面へ', () => {
    expect(evaluateAdminAccess({ hasSession: true, isMember: true, twoFactorEnabled: false })).toBe('setup_2fa');
  });

  it('メンバーかつ 2 要素認証済みなら入れる', () => {
    expect(evaluateAdminAccess({ hasSession: true, isMember: true, twoFactorEnabled: true })).toBe('ok');
  });
});
