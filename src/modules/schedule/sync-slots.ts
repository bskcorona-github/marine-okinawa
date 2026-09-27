import { and, eq, gte, inArray, lt, lte, ne, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { bookings, menus, scheduleExceptions, scheduleRules, shops, slots } from '@/db/schema';
import { addDays, localDate, zonedToUtc } from '@/lib/dates';
import { generateSlots } from './generate';

/** 何日先まで回を作っておくか */
export const SLOT_HORIZON_DAYS = 180;

/** closedBooked：この同期で休止になった、予約の入っている回の数（管理画面で警告する） */
export type SyncResult = { inserted: number; updated: number; deleted: number; closed: number; closedBooked: number };

/**
 * ルール・例外から期間内の回を作り直し、DB の slots に反映する。
 * - 予約が入っている回は削除せず closed にする
 * - weather_cancelled の回は変更しない
 */
export async function syncSlots(
  db: Db,
  params: { menuId: string; fromDate: string; toDate: string },
): Promise<SyncResult> {
  return db.transaction(async (tx) => {
    // 定期処理と管理画面の操作が同時に走っても、同じメニューの同期は直列にする（回の二重作成を防ぐ）
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sync-slots:${params.menuId}`}))`);
    const [menu] = await tx
      .select({ id: menus.id, shopId: menus.shopId, timezone: shops.timezone })
      .from(menus)
      .innerJoin(shops, eq(shops.id, menus.shopId))
      .where(eq(menus.id, params.menuId));
    if (!menu) throw new Error(`menu not found: ${params.menuId}`);

    const rules = await tx.select().from(scheduleRules).where(eq(scheduleRules.menuId, menu.id));
    const exceptions = await tx
      .select()
      .from(scheduleExceptions)
      .where(
        and(
          eq(scheduleExceptions.menuId, menu.id),
          gte(scheduleExceptions.date, params.fromDate),
          lte(scheduleExceptions.date, params.toDate),
        ),
      );
    const generated = generateSlots({
      rules,
      exceptions,
      fromDate: params.fromDate,
      toDate: params.toDate,
      timezone: menu.timezone,
    });

    const rangeStart = zonedToUtc(params.fromDate, '00:00', menu.timezone);
    const rangeEnd = zonedToUtc(addDays(params.toDate, 1), '00:00', menu.timezone);
    const existing = await tx
      .select()
      .from(slots)
      .where(and(eq(slots.menuId, menu.id), gte(slots.startsAt, rangeStart), lt(slots.startsAt, rangeEnd)))
      .for('update');
    const remaining = new Map(existing.map((s) => [s.startsAt.getTime(), s]));

    const result: SyncResult = { inserted: 0, updated: 0, deleted: 0, closed: 0, closedBooked: 0 };
    const toInsert: (typeof slots.$inferInsert)[] = [];

    for (const g of generated) {
      const current = remaining.get(g.startsAt.getTime());
      if (!current) {
        toInsert.push({
          shopId: menu.shopId,
          menuId: menu.id,
          startsAt: g.startsAt,
          capacity: g.capacity,
          status: g.status,
        });
        continue;
      }
      remaining.delete(g.startsAt.getTime());
      if (current.status === 'weather_cancelled') continue;
      if (current.capacity !== g.capacity || current.status !== g.status) {
        await tx.update(slots).set({ capacity: g.capacity, status: g.status }).where(eq(slots.id, current.id));
        result.updated++;
        if (g.status === 'closed' && current.status === 'open' && current.reservedCount > 0) result.closedBooked++;
      }
    }

    for (let i = 0; i < toInsert.length; i += 500) {
      await tx.insert(slots).values(toInsert.slice(i, i + 500));
    }
    result.inserted = toInsert.length;

    const obsolete = [...remaining.values()].filter((s) => s.status !== 'weather_cancelled');
    if (obsolete.length > 0) {
      const referenced = await tx
        .selectDistinct({ slotId: bookings.slotId })
        .from(bookings)
        .where(
          inArray(
            bookings.slotId,
            obsolete.map((s) => s.id),
          ),
        );
      const referencedIds = new Set(referenced.map((r) => r.slotId));
      const deletable = obsolete.filter((s) => !referencedIds.has(s.id)).map((s) => s.id);
      const closableSlots = obsolete.filter((s) => referencedIds.has(s.id) && s.status !== 'closed');
      const closable = closableSlots.map((s) => s.id);
      result.closedBooked += closableSlots.filter((s) => s.reservedCount > 0).length;
      if (deletable.length > 0) await tx.delete(slots).where(inArray(slots.id, deletable));
      if (closable.length > 0) await tx.update(slots).set({ status: 'closed' }).where(inArray(slots.id, closable));
      result.deleted = deletable.length;
      result.closed = closable.length;
    }

    return result;
  });
}

/** 今日（ショップのタイムゾーン）から SLOT_HORIZON_DAYS 日分を同期する */
export async function resyncMenu(db: Db, params: { menuId: string; timezone: string; now: Date }): Promise<SyncResult> {
  const fromDate = localDate(params.now, params.timezone);
  return syncSlots(db, { menuId: params.menuId, fromDate, toDate: addDays(fromDate, SLOT_HORIZON_DAYS - 1) });
}

/** 全ショップのアーカイブ以外の全メニューを同期する（定期処理用） */
export async function syncAllShops(db: Db, now: Date): Promise<{ menus: number; failed: number }> {
  const targets = await db
    .select({ menuId: menus.id, timezone: shops.timezone })
    .from(menus)
    .innerJoin(shops, eq(shops.id, menus.shopId))
    .where(ne(menus.status, 'archived'));
  let failed = 0;
  for (const t of targets) {
    // 1 メニューの失敗で残りのメニューの同期を止めない
    try {
      await resyncMenu(db, { menuId: t.menuId, timezone: t.timezone, now });
    } catch (error) {
      failed++;
      console.error(`syncAllShops: menu ${t.menuId} failed`, error);
    }
  }
  return { menus: targets.length, failed };
}
