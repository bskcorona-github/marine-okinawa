import { describe, expect, it } from 'vitest';
import { recipientName } from './recipient-name';

describe('メールの宛名', () => {
  it('ふつうの氏名はそのまま、URL・メールアドレス・長すぎる名前は「お客様」にする', () => {
    expect(recipientName('沖縄 太郎')).toBe('沖縄 太郎 様');
    expect(recipientName('Taro Okinawa')).toBe('Taro Okinawa 様');
    expect(recipientName('今すぐ https://spam.example へ')).toBe('お客様');
    expect(recipientName('spam.example.com で当選')).toBe('お客様');
    expect(recipientName('a@b.example')).toBe('お客様');
    expect(recipientName('あ'.repeat(41))).toBe('お客様');
    expect(recipientName('  ')).toBe('お客様');
  });
});
