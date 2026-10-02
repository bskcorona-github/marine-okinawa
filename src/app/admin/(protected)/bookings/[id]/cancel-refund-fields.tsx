'use client';

import { useState } from 'react';
import { SELECT_CLASS } from '@/components/backoffice/field-styles';
import { formatYen } from '@/lib/format';
import { cn } from '@/lib/utils';
import { FULL_REFUND_CANCEL_CATEGORIES } from '@/modules/booking/labels';
import { AmountField } from './amount-field';

/** 全額を返す取消の区分（組合・事業者の都合。キャンセル料はいただかない。サーバーでも確かめる） */
const FULL_REFUND_CATEGORIES = new Set<string>(FULL_REFUND_CANCEL_CATEGORIES);

/**
 * 取消の区分と返金予定額。区分を選ぶと返金予定額の初期値が入る：お客様のご都合はキャンセル料率を引いた額、
 * 組合・事業者の都合とその他は全額（入金済みでなければ返金予定額の欄は出さない）
 */
export function CancelRefundFields({
  categories,
  paid,
  customerRefund,
  customerHint,
  confirmedOnce,
}: {
  categories: { value: string; label: string }[];
  /** 入金済みなら入金額と返金済みの額（返金予定額の欄を出す） */
  paid: { amount: number; refunded: number } | null;
  /** お客様のご都合のときの初期値（キャンセル料率を引いた額）と、その説明 */
  customerRefund: number;
  customerHint: string;
  /** 一度でも予約確定になったか（確定前の取消は全額を返す） */
  confirmedOnce: boolean;
}) {
  const [category, setCategory] = useState('');
  const full = paid ? paid.amount : 0;
  const byCustomer = category === 'customer' && confirmedOnce;
  const initial = paid ? Math.max(paid.refunded, byCustomer ? customerRefund : full) : 0;
  const hint = !confirmedOnce
    ? `予約確定の前の取消のため、全額（${formatYen(full)}）を入れています。`
    : byCustomer
      ? customerHint
      : FULL_REFUND_CATEGORIES.has(category)
        ? `組合・事業者の都合の取消のため、全額（${formatYen(full)}）を返金します（キャンセル料はいただきません）。`
        : `全額（${formatYen(full)}）を入れています。キャンセル料をいただくときは直してください。`;
  return (
    <>
      <label className="block space-y-1">
        <span className="block font-medium">取消の区分（必須）</span>
        <select
          name="cancelCategory"
          required
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className={cn(SELECT_CLASS, 'w-full')}
        >
          <option value="" disabled>
            選んでください
          </option>
          {categories.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      {paid && (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
          {category ? (
            <AmountField
              // 区分を変えたら、初期値を入れ直す
              key={category}
              name="refundDueAmount"
              label="返金予定額（円・必須）"
              required
              refund
              expected={paid.amount}
              expectedLabel="入金額"
              defaultValue={initial}
              hint={hint}
              // 返金済みの額〜入金額（組合・事業者の都合は全額だけ）
              min={FULL_REFUND_CATEGORIES.has(category) ? paid.amount : paid.refunded}
              max={paid.amount}
            />
          ) : (
            <p className="text-sm text-amber-950">取消の区分を選ぶと、返金予定額の初期値が入ります。</p>
          )}
        </div>
      )}
    </>
  );
}
