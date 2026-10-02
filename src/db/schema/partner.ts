import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps } from './_columns';
import { user } from './auth';
import { bookings } from './booking';
import { menus, operators } from './catalog';
import { shops } from './shop';

/**
 * 事業者のログインアカウント（1 ユーザー＝1 事業者）。組合の管理者（shop_members）とは別に持ち、
 * 事業者専用画面（/partner）だけを使える。停止すると次の操作からログインできない
 */
export const operatorMembers = pgTable(
  'operator_members',
  {
    userId: text()
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    shopId: uuid()
      .notNull()
      .references(() => shops.id),
    operatorId: uuid()
      .notNull()
      .references(() => operators.id, { onDelete: 'cascade' }),
    disabledAt: timestamp({ withTimezone: true }),
    /** 仮パスワードのまま（発行・再発行のあと）。事業者が自分のパスワードに変えるまで、ほかの画面を使えない */
    passwordChangeRequired: boolean().notNull().default(false),
    createdBy: text().references(() => user.id),
    ...timestamps,
  },
  (t) => [index('operator_members_operator_idx').on(t.operatorId)],
);

/** プランの実施候補の事業者（1 プランに複数。予約ごとに組合がこの中から照会・割り当てる） */
export const menuOperators = pgTable(
  'menu_operators',
  {
    menuId: uuid()
      .notNull()
      .references(() => menus.id, { onDelete: 'cascade' }),
    operatorId: uuid()
      .notNull()
      .references(() => operators.id, { onDelete: 'cascade' }),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.menuId, t.operatorId] })],
);

/** 受入確認（照会）の状態。withdrawn：組合が照会を取り下げた（別の事業者に決まったなど） */
export const operatorRequestStatus = pgEnum('operator_request_status', [
  'pending',
  'accepted',
  'declined',
  'conditional',
  'withdrawn',
]);

/** 組合から事業者への受入確認（照会）と、事業者の回答。1 予約・1 事業者につき 1 件（照会し直すと更新） */
export const bookingOperatorRequests = pgTable(
  'booking_operator_requests',
  {
    id: uuid().primaryKey().defaultRandom(),
    bookingId: uuid()
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    operatorId: uuid()
      .notNull()
      .references(() => operators.id),
    status: operatorRequestStatus().notNull().default('pending'),
    /** 組合から事業者への連絡事項 */
    requestNote: text().notNull().default(''),
    /** 事業者の回答（条件付きのときの条件など） */
    responseNote: text().notNull().default(''),
    requestedAt: timestamp({ withTimezone: true }).notNull(),
    requestedBy: text().references(() => user.id),
    respondedAt: timestamp({ withTimezone: true }),
    respondedBy: text().references(() => user.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('booking_operator_requests_uq').on(t.bookingId, t.operatorId),
    index('booking_operator_requests_operator_idx').on(t.operatorId, t.status),
  ],
);

/** 事業者の資料の種類 */
export const documentKind = pgEnum('document_kind', ['insurance', 'license', 'invoice', 'photo', 'plan', 'other']);
/** 資料の受け取り方（Web でのアップロード・郵送・持参） */
export const documentReceivedVia = pgEnum('document_received_via', ['upload', 'mail', 'hand']);

/**
 * 事業者の資料（保険・許認可・インボイスなど）。登録申請の添付（applicationId）か、登録済みの事業者の資料（operatorId）。
 * 郵送・持参の資料はファイルなし（fileKey が null）で受付だけを登録する
 */
export const operatorDocuments = pgTable(
  'operator_documents',
  {
    id: uuid().primaryKey().defaultRandom(),
    shopId: uuid()
      .notNull()
      .references(() => shops.id),
    operatorId: uuid().references(() => operators.id, { onDelete: 'cascade' }),
    applicationId: uuid().references(() => operatorApplications.id, { onDelete: 'cascade' }),
    kind: documentKind().notNull(),
    title: text().notNull(),
    fileKey: text(),
    fileName: text(),
    mimeType: text(),
    size: integer(),
    /** 有効期限（保険・許認可など。ないものは null） */
    expiresOn: date({ mode: 'string' }),
    receivedVia: documentReceivedVia().notNull().default('upload'),
    note: text().notNull().default(''),
    uploadedBy: text().references(() => user.id),
    ...timestamps,
  },
  (t) => [
    index('operator_documents_operator_idx').on(t.operatorId),
    index('operator_documents_application_idx').on(t.applicationId),
    index('operator_documents_expires_idx').on(t.expiresOn),
  ],
);

export const applicationStatus = pgEnum('application_status', ['new', 'reviewing', 'approved', 'rejected']);

/** 事業者の登録申請（公開フォームから）。承認すると事業者として登録する */
export const operatorApplications = pgTable(
  'operator_applications',
  {
    id: uuid().primaryKey().defaultRandom(),
    shopId: uuid()
      .notNull()
      .references(() => shops.id),
    status: applicationStatus().notNull().default('new'),
    companyName: text().notNull(),
    address: text().notNull().default(''),
    representative: text().notNull().default(''),
    contactName: text().notNull(),
    phone: text().notNull(),
    email: text().notNull(),
    emergencyPhone: text().notNull().default(''),
    invoiceNumber: text().notNull().default(''),
    /** 提供したいプランの情報（アクティビティ・料金・所要時間・開催時間・対象年齢・定員・集合場所・参加条件など） */
    planInfo: text().notNull().default(''),
    message: text().notNull().default(''),
    consentedAt: timestamp({ withTimezone: true }).notNull(),
    /** 承認して登録した事業者 */
    operatorId: uuid().references(() => operators.id),
    reviewNote: text().notNull().default(''),
    reviewedBy: text().references(() => user.id),
    reviewedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('operator_applications_shop_idx').on(t.shopId, t.createdAt)],
);

export const changeRequestStatus = pgEnum('change_request_status', ['pending', 'approved', 'rejected']);

/** 事業者からの登録情報の更新申請（組合が確認して反映する） */
export const operatorChangeRequests = pgTable(
  'operator_change_requests',
  {
    id: uuid().primaryKey().defaultRandom(),
    shopId: uuid()
      .notNull()
      .references(() => shops.id),
    operatorId: uuid()
      .notNull()
      .references(() => operators.id, { onDelete: 'cascade' }),
    /** 変えたい項目と値（OperatorProfileChange） */
    payload: jsonb().$type<Record<string, string>>().notNull(),
    note: text().notNull().default(''),
    status: changeRequestStatus().notNull().default('pending'),
    requestedBy: text().references(() => user.id),
    reviewNote: text().notNull().default(''),
    reviewedBy: text().references(() => user.id),
    reviewedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('operator_change_requests_operator_idx').on(t.operatorId, t.status)],
);
