import { z } from 'zod';
import { isInvoiceNumber, normalizeInvoiceNumber } from './invoice-number';

/** インボイスの登録番号の入力（空欄、または T と 13 桁の数字） */
export const invoiceNumberSchema = z.preprocess(
  (v) => (typeof v === 'string' ? normalizeInvoiceNumber(v) : v),
  z
    .string()
    .max(14)
    .refine((v) => v === '' || isInvoiceNumber(v), 'インボイスの登録番号は T と 13 桁の数字で入力してください'),
);
