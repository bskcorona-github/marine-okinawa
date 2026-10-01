import { describe, expect, it } from 'vitest';
import { invoiceNumberSchema, normalizeInvoiceNumber } from './invoice';

describe('インボイスの登録番号', () => {
  it('全角・ハイフン・空白・小文字を直して受け付ける', () => {
    expect(normalizeInvoiceNumber('ｔ１２３４－５６７８－９０１２３')).toBe('T1234567890123');
    // マイナス記号・横線・ダッシュ・長音で区切った入力も受け付ける
    expect(normalizeInvoiceNumber('T1234−5678―9012—3')).toBe('T1234567890123');
    expect(normalizeInvoiceNumber('T1234ー5678ｰ90123')).toBe('T1234567890123');
    expect(invoiceNumberSchema.parse(' t1234567890123 ')).toBe('T1234567890123');
    expect(invoiceNumberSchema.parse('')).toBe('');
    expect(invoiceNumberSchema.safeParse('T123').success).toBe(false);
  });
});
