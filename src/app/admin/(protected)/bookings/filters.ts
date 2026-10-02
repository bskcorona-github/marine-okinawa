import { isOwnKey } from '@/lib/own';
import { isDateString, isUuid } from '@/lib/validation';
import { BOOKING_STATUS_LABELS } from '@/modules/booking/labels';
import {
  PAYMENT_FILTER_LABELS,
  STATUS_GROUP_LABELS,
  type PaymentFilter,
  type StatusFilter,
} from '@/modules/booking/queries';

function isStatusFilter(value: unknown): value is StatusFilter {
  return isOwnKey(BOOKING_STATUS_LABELS, value) || isOwnKey(STATUS_GROUP_LABELS, value);
}

export type BookingFilters = {
  query: string;
  date: string | null;
  dateTo: string | null;
  status: StatusFilter | null;
  menuId: string | null;
  operatorId: string | null;
  mailFailed: boolean;
  payment: PaymentFilter | null;
  /** 並び順。null は既定（参加日を指定したら参加日順、それ以外は申込の新しい順） */
  sort: 'date' | 'created' | null;
};

/**
 * 予約台帳の絞り込み条件を URL の値から読む（画面と CSV 出力で同じ条件にする）。
 * 知らない値は無視する
 */
export function parseBookingFilters(get: (key: string) => unknown): BookingFilters {
  const one = (key: string) => {
    const value = get(key);
    return typeof value === 'string' ? value : null;
  };
  const date = one('date');
  const to = one('to');
  const status = one('status');
  const menu = one('menu');
  const operator = one('operator');
  const payment = one('payment');
  const sort = one('sort');
  const validDate = isDateString(date) ? date : null;
  return {
    query: one('q') ?? '',
    date: validDate,
    dateTo: validDate && isDateString(to) && to >= validDate ? to : null,
    status: isStatusFilter(status) ? status : null,
    menuId: isUuid(menu) ? menu : null,
    operatorId: isUuid(operator) ? operator : null,
    mailFailed: one('mail') === 'failed',
    payment: isOwnKey(PAYMENT_FILTER_LABELS, payment) ? payment : null,
    sort: sort === 'date' || sort === 'created' ? sort : null,
  };
}
