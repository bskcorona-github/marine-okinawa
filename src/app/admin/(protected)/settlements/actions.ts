'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import { zonedToUtc } from '@/lib/dates';
import { isDateString, isMonthString, isUuid } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import {
  buildSettlements,
  confirmSettlement,
  markSettlementPaid,
  SettlementError,
  unconfirmSettlement,
} from '@/modules/settlement/settlements';
import { getShopById } from '@/modules/shop/shops';

/** 月の精算（下書き）を作る・計算し直す（締めた月だけ） */
export async function buildSettlementsAction(formData: FormData) {
  const admin = await requireAdmin();
  const period = String(formData.get('period') ?? '');
  if (!isMonthString(period)) redirect('/admin/settlements?error=INVALID_PERIOD');
  let result: Awaited<ReturnType<typeof buildSettlements>>;
  try {
    result = await buildSettlements(db, { shopId: admin.shopId, period, actorId: admin.userId, now: new Date() });
  } catch (error) {
    if (error instanceof SettlementError) redirect(`/admin/settlements?period=${period}&error=${error.code}`);
    throw error;
  }
  revalidatePath('/admin', 'layout');
  redirect(
    `/admin/settlements?period=${period}&built=${result.drafts}&awaitingReport=${result.awaitingReport}&awaitingVerification=${result.awaitingVerification}`,
  );
}

/**
 * 精算 1 件の操作（確定・取り消し・振込）。失敗は画面の上に出す。run は結果（画面に出す done）を返す
 */
async function command(id: string, run: (ctx: { shopId: string; id: string; actorId: string }) => Promise<string>) {
  const admin = await requireAdmin();
  if (!isUuid(id)) redirect('/admin/settlements');
  let done: string;
  try {
    done = await run({ shopId: admin.shopId, id, actorId: admin.userId });
  } catch (error) {
    if (error instanceof SettlementError) redirect(`/admin/settlements/${id}?error=${error.code}`);
    throw error;
  }
  revalidatePath('/admin', 'layout');
  revalidatePath('/partner', 'layout');
  redirect(`/admin/settlements/${id}?done=${done}`);
}

/** 画面で見た支払額・件数（確定・振込の直前に今の値と比べる。ほかの画面で変わっていたら止める） */
const seenSchema = z.object({
  payoutAmount: z.coerce.number().int(),
  itemCount: z.coerce.number().int().min(0),
  adjustmentCount: z.coerce.number().int().min(0),
});

function seenOf(id: string, formData: FormData) {
  const parsed = seenSchema.safeParse({
    payoutAmount: formData.get('seenPayoutAmount'),
    itemCount: formData.get('seenItemCount'),
    adjustmentCount: formData.get('seenAdjustmentCount'),
  });
  if (!parsed.success) redirect(`/admin/settlements/${id}?error=CHANGED`);
  return parsed.data;
}

/** 確定する（計算し直して数字が変わっていたら確定せず、確かめてもらう。明細がなくなったら一覧へ） */
export async function confirmSettlementAction(id: string, formData: FormData) {
  const seen = seenOf(id, formData);
  await command(id, async (ctx) => {
    const { result, period } = await confirmSettlement(db, { ...ctx, now: new Date(), seen });
    if (result === 'removed') redirect(`/admin/settlements?period=${period}&removed=1`);
    return result;
  });
}

/**
 * その月の下書きをまとめて確定する。1 件ずつ、画面で見た金額・件数（seen:<id>）と比べてから確定し、
 * 数字が変わっていた・確定できなかったものは下書きのまま残して件数を知らせる
 */
export async function confirmAllSettlementsAction(formData: FormData) {
  const admin = await requireAdmin();
  const period = String(formData.get('period') ?? '');
  if (!isMonthString(period)) redirect('/admin/settlements?error=INVALID_PERIOD');
  const ids = formData.getAll('id').filter((id): id is string => isUuid(id));
  let confirmed = 0;
  let skipped = 0;
  for (const id of ids) {
    const [payoutAmount, itemCount, adjustmentCount] = String(formData.get(`seen:${id}`) ?? '').split(':');
    const seen = seenSchema.safeParse({ payoutAmount, itemCount, adjustmentCount });
    if (!seen.success) {
      skipped++;
      continue;
    }
    try {
      const { result } = await confirmSettlement(db, {
        shopId: admin.shopId,
        id,
        actorId: admin.userId,
        now: new Date(),
        seen: seen.data,
      });
      if (result === 'confirmed') confirmed++;
      else skipped++;
    } catch (error) {
      // 下書きでなくなった・明細がないなど：その精算は確定せず、残りを続ける
      if (error instanceof SettlementError) {
        skipped++;
        continue;
      }
      throw error;
    }
  }
  revalidatePath('/admin', 'layout');
  revalidatePath('/partner', 'layout');
  redirect(`/admin/settlements?period=${period}&confirmedAll=${confirmed}&skipped=${skipped}`);
}

/** 確定を取り消す（理由を記録に残す。事業者画面から明細が消えるため） */
export async function unconfirmSettlementAction(id: string, formData: FormData) {
  const reason = String(formData.get('reason') ?? '')
    .trim()
    .slice(0, 300);
  await command(id, async (ctx) => {
    await unconfirmSettlement(db, { ...ctx, reason });
    return 'unconfirmed';
  });
}

export async function markSettlementPaidAction(id: string, formData: FormData) {
  const paidOn = String(formData.get('paidOn') ?? '');
  const note = String(formData.get('note') ?? '')
    .trim()
    .slice(0, 200);
  if (!isDateString(paidOn)) redirect(`/admin/settlements/${id}?error=INVALID_DATE`);
  const { payoutAmount } = seenOf(id, formData);
  await command(id, async (ctx) => {
    const shop = await getShopById(db, ctx.shopId);
    await markSettlementPaid(db, {
      ...ctx,
      paidAt: zonedToUtc(paidOn, '12:00', shop.timezone),
      note,
      now: new Date(),
      seenPayoutAmount: payoutAmount,
    });
    return 'paid';
  });
}
