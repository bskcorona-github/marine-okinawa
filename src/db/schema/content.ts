import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_columns';
import { user } from './auth';
import { shops } from './shop';

/** 固定ページ（初めての方へ・予約方法・安全への取組み・プライバシーポリシー・運営者情報）。本文は管理画面で編集する */
export const sitePages = pgTable(
  'site_pages',
  {
    id: uuid().primaryKey().defaultRandom(),
    shopId: uuid()
      .notNull()
      .references(() => shops.id),
    slug: text().notNull(),
    title: text().notNull(),
    /** 「## 見出し」「- 箇条書き」だけの簡単な書式 */
    body: text().notNull().default(''),
    updatedBy: text().references(() => user.id),
    ...timestamps,
  },
  (t) => [uniqueIndex('site_pages_shop_slug_uq').on(t.shopId, t.slug)],
);

export const inquiryKind = pgEnum('inquiry_kind', ['booking', 'group', 'partner', 'other']);
export const inquiryStatus = pgEnum('inquiry_status', ['new', 'in_progress', 'done']);

/** お問い合わせ（予約とは別に、団体・学校・企業の相談や事業者登録の相談も受ける） */
export const inquiries = pgTable(
  'inquiries',
  {
    id: uuid().primaryKey().defaultRandom(),
    shopId: uuid()
      .notNull()
      .references(() => shops.id),
    kind: inquiryKind().notNull(),
    name: text().notNull(),
    email: text().notNull(),
    phone: text(),
    message: text().notNull(),
    status: inquiryStatus().notNull().default('new'),
    /** プライバシーポリシーに同意した日時 */
    consentedAt: timestamp({ withTimezone: true }).notNull(),
    /** 組合の対応メモ */
    note: text().notNull().default(''),
    handledBy: text().references(() => user.id),
    ...timestamps,
  },
  (t) => [index('inquiries_shop_created_idx').on(t.shopId, t.createdAt)],
);
