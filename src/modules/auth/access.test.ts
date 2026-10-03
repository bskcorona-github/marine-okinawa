import { describe, expect, it } from 'vitest';
import { evaluateAccess } from './access';

describe('evaluateAccess', () => {
  it('未ログイン・どちらのメンバーでもない人はログインへ', () => {
    expect(
      evaluateAccess({
        hasSession: false,
        role: null,
        twoFactorEnabled: false,
        hasSocialLogin: false,
        hasPassword: true,
        required: 'admin',
      }),
    ).toBe('login');
    expect(
      evaluateAccess({
        hasSession: true,
        role: null,
        twoFactorEnabled: true,
        hasSocialLogin: false,
        hasPassword: true,
        required: 'operator',
      }),
    ).toBe('login');
  });

  it('事業者は管理画面に、管理者は事業者画面に入れない（それぞれの画面へ移す）', () => {
    expect(
      evaluateAccess({
        hasSession: true,
        role: 'operator',
        twoFactorEnabled: true,
        hasSocialLogin: false,
        hasPassword: true,
        required: 'admin',
      }),
    ).toBe('other_role');
    expect(
      evaluateAccess({
        hasSession: true,
        role: 'admin',
        twoFactorEnabled: true,
        hasSocialLogin: false,
        hasPassword: true,
        required: 'operator',
      }),
    ).toBe('other_role');
  });

  it('2 要素認証が未設定なら設定画面へ。設定済みなら入れる', () => {
    expect(
      evaluateAccess({
        hasSession: true,
        role: 'admin',
        twoFactorEnabled: false,
        hasSocialLogin: false,
        hasPassword: true,
        required: 'admin',
      }),
    ).toBe('setup_2fa');
    expect(
      evaluateAccess({
        hasSession: true,
        role: 'operator',
        twoFactorEnabled: false,
        hasSocialLogin: false,
        hasPassword: true,
        required: 'operator',
      }),
    ).toBe('setup_2fa');
    expect(
      evaluateAccess({
        hasSession: true,
        role: 'operator',
        twoFactorEnabled: true,
        hasSocialLogin: false,
        hasPassword: true,
        required: 'operator',
      }),
    ).toBe('ok');
  });

  it('LINE・Google をつないだ人は認証アプリなしで入れる。何も決めていない人は、ログインの方法を決める画面へ', () => {
    const base = {
      hasSession: true,
      role: 'operator' as const,
      twoFactorEnabled: false,
      required: 'operator' as const,
    };
    expect(evaluateAccess({ ...base, hasSocialLogin: true, hasPassword: false })).toBe('ok');
    expect(evaluateAccess({ ...base, hasSocialLogin: false, hasPassword: false })).toBe('setup_login');
    expect(evaluateAccess({ ...base, hasSocialLogin: false, hasPassword: true })).toBe('setup_2fa');
  });
});
