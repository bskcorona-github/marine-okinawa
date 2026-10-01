import { describe, expect, it } from 'vitest';
import { evaluateAccess } from './access';

describe('evaluateAccess', () => {
  it('未ログイン・どちらのメンバーでもない人はログインへ', () => {
    expect(evaluateAccess({ hasSession: false, role: null, twoFactorEnabled: false, required: 'admin' })).toBe('login');
    expect(evaluateAccess({ hasSession: true, role: null, twoFactorEnabled: true, required: 'operator' })).toBe(
      'login',
    );
  });

  it('事業者は管理画面に、管理者は事業者画面に入れない（それぞれの画面へ移す）', () => {
    expect(evaluateAccess({ hasSession: true, role: 'operator', twoFactorEnabled: true, required: 'admin' })).toBe(
      'other_role',
    );
    expect(evaluateAccess({ hasSession: true, role: 'admin', twoFactorEnabled: true, required: 'operator' })).toBe(
      'other_role',
    );
  });

  it('2 要素認証が未設定なら設定画面へ。設定済みなら入れる', () => {
    expect(evaluateAccess({ hasSession: true, role: 'admin', twoFactorEnabled: false, required: 'admin' })).toBe(
      'setup_2fa',
    );
    expect(evaluateAccess({ hasSession: true, role: 'operator', twoFactorEnabled: false, required: 'operator' })).toBe(
      'setup_2fa',
    );
    expect(evaluateAccess({ hasSession: true, role: 'operator', twoFactorEnabled: true, required: 'operator' })).toBe(
      'ok',
    );
  });
});
