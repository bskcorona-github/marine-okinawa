import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '@/db/client';
import {
  bookingItems,
  bookings,
  bookingStatusEvents,
  menus,
  menuTranslations,
  operators,
  payments,
  shops,
  type PolicySnapshot,
} from '@/db/schema';
import { localDate } from '@/lib/dates';
import { writeAuditLog } from '@/modules/audit/log';
import { listPricesForDate } from '@/modules/catalog/prices';
import { normalizeEmail, normalizePhone } from '@/modules/customer/normalize';
import { resolveCustomer } from '@/modules/customer/resolve';
import { bookingDeadline, isPastDeadline } from '@/modules/inventory/availability';
import { lockSlot, reserveSeats } from '@/modules/inventory/reserve';
import { addReceipt } from '@/modules/payment/ledger';
import { paymentDueAt, resolveSettings } from '@/modules/shop/settings';
import { accessTokenExpiry, addBookingAccessToken } from './access-token';
import { feeSettingsOf } from './cancellation-fee';
import { generateBookingNo } from './booking-no';
import { BookingError } from './errors';
import { priceItems, type ItemRequest } from './pricing';
import { OPEN_REQUEST_STATUSES } from './status';
import { DEFAULT_LOCALE } from '@/lib/locale';
import { isPerPerson } from '@/modules/catalog/capacity-unit';

export type ManualBookingSource = 'phone' | 'line' | 'walk_in';

/** 手動予約で選べる最初の状態（Web の申込は必ず仮受付） */
export type InitialStatus = 'requested' | 'awaiting_payment' | 'confirmed';

const SOURCE_NOTES: Record<'web' | ManualBookingSource, string> = {
  web: 'Web から申込',
  phone: '電話で受付',
  line: 'LINE で受付',
  walk_in: '店頭で受付',
};

/** 乗船人数の上限（入力ミスの防止。実際の上限はプランの参加条件で案内する） */
export const MAX_GUEST_COUNT = 200;

/** 貸切の基本料金に含まれる人数を超えた人数と追加料金（設定がなければ 0） */
export function extraGuestsOf(
  menu: { includedGuests: number | null; extraGuestPrice: number | null },
  guestCount: number | null,
): { count: number; amount: number } {
  if (!guestCount || !menu.includedGuests || !menu.extraGuestPrice) return { count: 0, amount: 0 };
  const count = Math.max(0, guestCount - menu.includedGuests);
  return { count, amount: count * menu.extraGuestPrice };
}

/** 申込の自由入力（第 2 希望・備考・年齢）。空欄は null にする */
const textOrNull = (value: string | null | undefined) => value?.trim() || null;

export type CreateBookingInput = {
  shopId: string;
  slotId: string;
  source: 'web' | ManualBookingSource;
  items: ItemRequest[];
  contact: { name: string; email?: string | null; phone?: string | null };
  locale: string;
  /** 手動予約で定員を超えて受ける場合の理由 */
  overCapacityReason?: string | null;
  /** 乗船人数（定員を艇で数える貸切プランだけ。Web 予約では必須） */
  guestCount?: number | null;
  /** 第 2 希望の日時・備考・参加者の年齢（年齢の確認が必要なプランの Web 申込では年齢が必須） */
  request?: { secondChoice?: string | null; customerNote?: string | null; participantAges?: string | null };
  /** 参加条件・キャンセル規定・個人情報の取扱いへの同意（Web 申込では必須。同意日時は now） */
  consented?: boolean;
  /** 手動予約の最初の状態（既定は仮受付）と支払方法（既定は組合への事前払い） */
  initialStatus?: InitialStatus;
  paymentMethod?: 'online' | 'onsite';
  /** 事前払いで「予約確定」として登録するときの入金の記録（省略時は料金の全額を今の時刻で） */
  payment?: { amount: number; receivedAt: Date; note?: string };
  /**
   * 手動予約で組合が選んだ実施事業者（省略時はプランの初期値）。operatorConfirmed は、電話などで受入を確かめたこと
   * （支払待ち・予約確定で登録するときの記録）
   */
  operator?: { id: string | null; confirmed: boolean };
  /** カード決済（Stripe）で受け付けるとき true（支払方法の案内の文面がなくても支払待ちで登録できる） */
  cardPayment?: boolean;
  actorId?: string | null;
  now: Date;
};

export type CreateBookingResult = {
  bookingId: string;
  bookingNo: string;
  accessToken: string;
  status: InitialStatus;
};

/**
 * 予約（申込）を作成する。Web の申込は「仮受付」で、組合の確認・入金の確認を経て確定する。
 * 手動予約は最初の状態を選べる（予約確定で登録するときは、事前払いなら入金済みとして記録する）。
 * 枠の確認・確保・予約作成を 1 トランザクションで行い、二重予約を防ぐ。
 */
export async function createBooking(db: Db, input: CreateBookingInput): Promise<CreateBookingResult> {
  const isWeb = input.source === 'web';
  const name = input.contact.name.trim();
  const email = normalizeEmail(input.contact.email);
  const phone = normalizePhone(input.contact.phone);
  const hasRequiredContact = isWeb ? Boolean(email && phone) : Boolean(email || phone);
  // 入力された電話番号が正規化できない場合は、黙って捨てずにエラーにする
  const invalidPhone = Boolean(input.contact.phone?.trim()) && !phone;
  if (!name || !hasRequiredContact || invalidPhone) throw new BookingError('CONTACT_REQUIRED');
  if (isWeb && !input.consented) throw new BookingError('AGREEMENT_REQUIRED');

  const overCapacityReason = isWeb ? null : input.overCapacityReason?.trim() || null;
  const status: InitialStatus = isWeb ? 'requested' : (input.initialStatus ?? 'requested');
  const paymentMethod = isWeb ? 'online' : (input.paymentMethod ?? 'online');
  const secondChoice = textOrNull(input.request?.secondChoice);
  const customerNote = textOrNull(input.request?.customerNote);
  const participantAges = textOrNull(input.request?.participantAges);

  const booking = await db.transaction(async (tx) => {
    const slot = await lockSlot(tx, input.slotId);
    if (slot.shopId !== input.shopId) throw new BookingError('SLOT_NOT_FOUND');

    const [menu] = await tx.select().from(menus).where(eq(menus.id, slot.menuId));
    const [shop] = await tx
      .select({ timezone: shops.timezone, settings: shops.settings })
      .from(shops)
      .where(eq(shops.id, slot.shopId));
    const { timezone } = shop;
    const settings = resolveSettings(shop.settings);
    // 季節料金：回の日付（ショップのタイムゾーン）に有効な料金区分だけを受け付ける
    const { prices } = await listPricesForDate(tx, {
      menuId: menu.id,
      operatorId: menu.operatorId,
      date: localDate(slot.startsAt, timezone),
    });
    const priced = priceItems(prices, input.items);
    const chosenOperator = !isWeb && input.operator !== undefined;
    const operatorCandidate = chosenOperator ? input.operator!.id : menu.operatorId;
    let assignedOperatorId: string | null = null;
    if (operatorCandidate) {
      const [op] = await tx
        .select({ id: operators.id, status: operators.status })
        .from(operators)
        .where(and(eq(operators.id, operatorCandidate), eq(operators.shopId, input.shopId)));
      if (chosenOperator && (!op || op.status === 'suspended')) {
        throw new BookingError(op ? 'OPERATOR_SUSPENDED' : 'OPERATOR_NOT_FOUND');
      }
      // プランの初期値の事業者が停止中なら、割り当てずに組合が選ぶ
      assignedOperatorId = op && op.status !== 'suspended' ? op.id : null;
    }
    // 組合の画面からの手動予約で、支払待ち・確定で登録するときは、実施事業者がいて受入を確かめたことを求める
    if (chosenOperator && status !== 'requested') {
      if (!assignedOperatorId) throw new BookingError('OPERATOR_REQUIRED');
      if (!input.operator!.confirmed) throw new BookingError('OPERATOR_UNCONFIRMED');
    }
    // 組合がプランの初期値と別の事業者を選んだときだけ「組合が選んだ」にする（未割り当て・初期値のままは回答で決まる）
    const assignedVia =
      chosenOperator && assignedOperatorId && assignedOperatorId !== menu.operatorId ? 'staff' : 'default';
    // 貸切プラン（定員を艇で数える）は、実際に乗る人数を別に持つ。人数で数えるプランでは使わない
    const byBoat = !isPerPerson(menu.capacityUnit);
    const guestCount = byBoat && input.guestCount ? input.guestCount : null;
    if (guestCount !== null && (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > MAX_GUEST_COUNT)) {
      throw new BookingError('GUEST_COUNT_REQUIRED');
    }
    // 貸切は乗船人数が必須（当日の人数と、追加料金・参加人数の集計に使う）
    if (byBoat && guestCount === null) throw new BookingError('GUEST_COUNT_REQUIRED');
    if (guestCount !== null && menu.maxGuests && guestCount > menu.maxGuests) {
      throw new BookingError('GUEST_COUNT_TOO_LARGE');
    }
    // 基本料金に含まれる人数を超えた分の追加料金（予約時点のメニューの設定で計算して保存する）
    const extra = extraGuestsOf(menu, guestCount);
    const totalAmount = priced.totalAmount + extra.amount;

    // 手動予約：現地払いは支払案内を送らない。事前払いの支払待ちは、支払方法の案内がないと支払えない
    if (!isWeb && status === 'awaiting_payment') {
      if (paymentMethod === 'onsite') throw new BookingError('INVALID_TRANSITION');
      if (!settings.paymentInstructions && !input.cardPayment) throw new BookingError('PAYMENT_INSTRUCTIONS_MISSING');
    }
    if (isWeb) {
      if (settings.bookingPaused) throw new BookingError('BOOKING_PAUSED');
      if (menu.status === 'paused') throw new BookingError('MENU_PAUSED');
      if (menu.status !== 'published') throw new BookingError('SLOT_CLOSED');
      if (isPastDeadline(bookingDeadline(slot.startsAt, menu, timezone), input.now)) {
        throw new BookingError('PAST_CUTOFF');
      }
      if (priced.partySize > menu.maxPartySize) throw new BookingError('PARTY_TOO_LARGE');
      // 最少人数（「2名から」など）は人数で数えるプランだけ。貸切は 1 回 1 艇
      if (!byBoat && priced.partySize < menu.minPartySize) throw new BookingError('PARTY_TOO_SMALL');
      if (menu.requireAges && !participantAges) throw new BookingError('AGES_REQUIRED');
      // 同じメールアドレスで同じ回に有効な申込・予約があれば二重送信とみなす（回の行ロック中なので確実に判定できる）
      const [duplicate] = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(
            eq(bookings.slotId, slot.id),
            eq(bookings.contactEmail, email!),
            inArray(bookings.status, [...OPEN_REQUEST_STATUSES, 'confirmed']),
          ),
        )
        .limit(1);
      if (duplicate) throw new BookingError('DUPLICATE_BOOKING');
    }

    const { overCapacity } = await reserveSeats(tx, slot, priced.partySize, {
      allowOverCapacity: overCapacityReason !== null,
    });

    const customerId = await resolveCustomer(tx, { shopId: input.shopId, name, email, phone, locale: input.locale });

    // 同意した文面（あとから規定を変えても、申込時点の内容を確認できるように残す）
    const [translation] = await tx
      .select({
        conditions: menuTranslations.conditions,
        notes: menuTranslations.notes,
        cancellationPolicy: menuTranslations.cancellationPolicy,
        weatherPolicy: menuTranslations.weatherPolicy,
      })
      .from(menuTranslations)
      .where(and(eq(menuTranslations.menuId, menu.id), eq(menuTranslations.locale, DEFAULT_LOCALE)));
    // 申込のときの規定。電話などの申込（同意の画面を通らない）でも残す（あとで設定を変えても、この予約は申込のときの率で扱う）
    const policySnapshot: PolicySnapshot = {
      commonCancellationPolicy: settings.commonCancellationPolicy,
      commonWeatherPolicy: settings.commonWeatherPolicy,
      cancellationRates: feeSettingsOf(settings),
      ...translation,
    };

    const [created] = await tx
      .insert(bookings)
      .values({
        shopId: input.shopId,
        bookingNo: generateBookingNo(),
        slotId: slot.id,
        customerId,
        source: input.source,
        status,
        paymentMethod,
        totalAmount,
        partySize: priced.partySize,
        guestCount,
        extraGuestAmount: extra.amount,
        extraGuestCount: extra.count,
        locale: input.locale,
        contactName: name,
        contactEmail: email,
        contactPhone: phone,
        accessTokenExpiresAt: accessTokenExpiry(slot.startsAt, menu.durationMin),
        overCapacityReason: overCapacity ? overCapacityReason : null,
        createdBy: input.actorId ?? null,
        operatorId: assignedOperatorId,
        operatorAssignedVia: assignedVia,
        secondChoice,
        customerNote,
        participantAges,
        consentedAt: input.consented ? input.now : null,
        policySnapshot,
      })
      .returning({ id: bookings.id, bookingNo: bookings.bookingNo });

    await tx.insert(bookingItems).values(priced.lines.map((line) => ({ bookingId: created.id, ...line })));
    const accessToken = await addBookingAccessToken(tx, created.id);
    // 支払いは 1 予約に 1 件。支払待ちにしたときに期限を入れ、入金を確認したら入金済みにする
    const paidAtCreation = status === 'confirmed' && paymentMethod === 'online';
    const paid = paidAtCreation ? (input.payment ?? { amount: totalAmount, receivedAt: input.now }) : null;
    if (paid && (!Number.isInteger(paid.amount) || paid.amount < 1)) throw new BookingError('PAYMENT_REQUIRED');
    const [payment] = await tx
      .insert(payments)
      .values({
        shopId: input.shopId,
        bookingId: created.id,
        method: paymentMethod,
        amount: totalAmount,
        status: 'pending',
        dueAt:
          status === 'awaiting_payment'
            ? paymentDueAt({ now: input.now, startsAt: slot.startsAt, days: settings.paymentDueDays, timezone })
            : null,
      })
      .returning();
    // 入金済みで登録した予約は、入金を 1 件記録する（支払いの額・状態も入金に合わせる）
    if (paid) {
      await addReceipt(tx, {
        payment,
        amount: paid.amount,
        receivedAt: paid.receivedAt,
        method: 'transfer',
        purpose: 'payment',
        note: paid.note?.trim() || '予約の登録時に入金済み',
        actorId: input.actorId ?? null,
      });
    }
    await tx.insert(bookingStatusEvents).values({
      bookingId: created.id,
      fromStatus: null,
      toStatus: status,
      actorType: isWeb ? 'customer' : 'staff',
      actorId: isWeb ? null : (input.actorId ?? null),
      note:
        SOURCE_NOTES[input.source] +
        (!isWeb && input.operator?.confirmed && status !== 'requested'
          ? '（実施事業者の受入は電話などで確認済み）'
          : ''),
    });

    if (overCapacity) {
      await writeAuditLog(tx, {
        shopId: input.shopId,
        actorId: input.actorId ?? null,
        action: 'booking.over_capacity',
        targetType: 'booking',
        targetId: created.id,
        before: { capacity: slot.capacity, reservedCount: slot.reservedCount },
        after: { reservedCount: slot.reservedCount + priced.partySize, reason: overCapacityReason },
      });
    }

    return { ...created, accessToken };
  });

  return { bookingId: booking.id, bookingNo: booking.bookingNo, accessToken: booking.accessToken, status };
}
