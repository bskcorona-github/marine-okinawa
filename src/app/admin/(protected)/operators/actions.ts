'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { isUuid } from '@/lib/validation';
import { invalidState, toFormIssues, type AdminFormState } from '@/lib/zod-ja';
import { requireAdmin } from '@/modules/auth/guard';
import { saveWithAutoSlug } from '@/modules/catalog/auto-slug';
import {
  createOperator,
  newOperatorSchema,
  operatorInputSchema,
  parsePeriodLines,
  updateOperator,
} from '@/modules/catalog/operator-admin';

/** 事業者を追加する。ID を空欄にしたときは自動で付ける（登録申請の承認と同じ作り方。重複したら作り直す） */
export async function createOperatorAction(formData: FormData) {
  const admin = await requireAdmin();
  const name = String(formData.get('name') ?? '');
  const slug = String(formData.get('slug') ?? '').trim();
  const create = async (value: string) => {
    const parsed = newOperatorSchema.safeParse({ name, slug: value });
    return parsed.success ? createOperator(db, admin.shopId, parsed.data, admin.userId) : null;
  };
  const result = slug ? await create(slug) : await saveWithAutoSlug('operator', create, (r) => r !== null && !r.ok);
  if (!result) redirect('/admin/operators?error=input');
  if (!result.ok) redirect('/admin/operators?error=slug');
  revalidatePath('/admin', 'layout');
  redirect(`/admin/operators/${result.operatorId}`);
}

const OPERATOR_FIELD_LABELS: Record<string, string> = {
  name: '事業者名',
  status: '登録状態',
  about: '組合のメモ',
  phone: '当日の連絡先（電話）',
  contactHours: '電話の受付時間',
  email: '連絡用メールアドレス',
  contactName: '担当者',
  emergencyPhone: '緊急連絡先',
  address: '所在地',
  representative: '代表者',
  invoiceNumber: 'インボイスの登録番号',
  bankAccount: '精算口座',
};

export async function updateOperatorAction(
  operatorId: string,
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const admin = await requireAdmin();
  if (!isUuid(operatorId)) redirect('/admin/operators');
  const raw = Object.fromEntries(formData) as Record<string, string>;
  const parsed = operatorInputSchema.safeParse(raw);
  if (!parsed.success) return invalidState(toFormIssues(parsed.error, OPERATOR_FIELD_LABELS));
  const periods = parsePeriodLines(raw.periods ?? '');
  if (!periods.ok) {
    return invalidState([
      {
        field: 'periods',
        message: `繁忙期の期間（${periods.line} 件目）：日付を確認してください（終了日は開始日以降）`,
      },
    ]);
  }
  const ok = await updateOperator(db, admin.shopId, operatorId, parsed.data, periods.periods, admin.userId);
  if (!ok) redirect('/admin/operators');
  revalidatePath('/', 'layout');
  // saved に時刻を入れて、保存後にフォームを作り直す（未保存の印を消す）
  redirect(`/admin/operators/${operatorId}?saved=${Date.now()}`);
}
