import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { shops } from './shop';

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid().primaryKey().defaultRandom(),
    shopId: uuid()
      .notNull()
      .references(() => shops.id),
    actorId: text().references(() => user.id),
    /** 誰の操作か（staff：組合／operator：事業者／customer：お客様・申請者／system：自動の処理） */
    actorType: text().$type<'staff' | 'operator' | 'customer' | 'system'>().notNull().default('staff'),
    action: text().notNull(),
    targetType: text().notNull(),
    targetId: text().notNull(),
    before: jsonb(),
    after: jsonb(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 予約の詳細の履歴（対象ごと）と、日報の集計（操作の種類ごと）、操作した人ごとの履歴
    index('audit_logs_target_idx').on(t.shopId, t.targetType, t.targetId, t.createdAt),
    index('audit_logs_action_idx').on(t.shopId, t.action, t.createdAt),
    index('audit_logs_actor_idx').on(t.shopId, t.actorId, t.createdAt),
    // 管理画面の「操作の記録」（新しい順）
    index('audit_logs_shop_created_idx').on(t.shopId, t.createdAt),
    check('audit_logs_actor_type_check', sql`${t.actorType} in ('staff', 'operator', 'customer', 'system')`),
  ],
);
