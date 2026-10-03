import { CalendarDays, Users } from 'lucide-react';
import Link from 'next/link';
import { SELECT_CLASS } from '@/components/backoffice/field-styles';
import { Notice, PageHeader } from '@/components/backoffice/page-header';
import { SubmitOnChange } from '@/components/backoffice/submit-on-change';
import { Button } from '@/components/ui/button';
import { db } from '@/db';
import { addDays, formatDateLabel, localDate, localTime, zonedToUtc } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { isDateString, isUuid } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import { SLOT_STATUS_LABELS } from '@/modules/booking/labels';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { listMenusForAdmin } from '@/modules/catalog/menus';
import { listOperators } from '@/modules/catalog/menus';
import { listPricesForDate } from '@/modules/catalog/prices';
import { SEASON_LABELS } from '@/modules/catalog/season';
import { remainingSeats } from '@/modules/inventory/availability';
import { getSlotForAdmin, listSlotsForDate } from '@/modules/inventory/queries';
import { getShopById } from '@/modules/shop/shops';
import { isPastSlotDay } from '@/modules/schedule/slot-day';
import { getInquiry } from '@/modules/content/inquiries';
import { cardPaymentsActive } from '@/modules/payment/card-payments';
import { occupancyText, occupancyTone, TONE_STYLE } from '@/components/backoffice/occupancy';
import { ManualBookingForm } from './manual-booking-form';

export const metadata = { title: '手動予約' };

export default async function ManualBookingPage({ searchParams }: PageProps<'/admin/bookings/new'>) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const shop = await getShopById(db, admin.shopId);
  // お問い合わせから開いたとき（?inquiry=）は、その方の連絡先を入力欄に入れる（URL にはお問い合わせの番号だけを載せる）
  const inquiry = isUuid(sp.inquiry) ? await getInquiry(db, { shopId: shop.id, inquiryId: sp.inquiry }) : null;
  const withInquiry = (href: string) => (inquiry ? `${href}&inquiry=${inquiry.id}` : href);
  const inquiryNotice = inquiry && (
    <Notice tone="info" className="max-w-xl">
      お問い合わせ（{inquiry.name} 様）の連絡先を、お客様の欄に入れています。
    </Notice>
  );

  // 回が決まっていれば入力フォーム
  if (isUuid(sp.slot)) {
    const slot = await getSlotForAdmin(db, { shopId: shop.id, slotId: sp.slot });
    if (slot) {
      const date = localDate(slot.startsAt, shop.timezone);
      const { season, prices } = await listPricesForDate(db, {
        menuId: slot.menuId,
        operatorId: slot.operatorId,
        date,
      });
      const remaining = remainingSeats(slot.capacity, slot.reservedCount);
      const operators = await listOperators(db, shop.id);
      return (
        <div className="space-y-4">
          <PageHeader
            back={{ href: withInquiry(`/admin/bookings/new?menu=${slot.menuId}&date=${date}`), label: '回を選び直す' }}
            title="手動予約"
          />
          {inquiryNotice}
          <div className="max-w-xl rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
            <p className="font-semibold">{splitPlanTitle(slot.menuTitle).title}</p>
            <dl className="mt-2 grid gap-1.5">
              <div className="flex items-center gap-2">
                <dt>
                  <CalendarDays aria-hidden className="size-4" />
                  <span className="sr-only">日時</span>
                </dt>
                <dd className="tabular-nums">
                  {formatDateLabel(slot.startsAt, shop.timezone)} {localTime(slot.startsAt, shop.timezone)}
                  {prices.some((p) => p.season) && `（料金は${SEASON_LABELS[season]}）`}
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <dt>
                  <Users aria-hidden className="size-4" />
                  <span className="sr-only">空き状況</span>
                </dt>
                <dd className="font-semibold tabular-nums">
                  {slot.status === 'open' ? occupancyText(slot, slot.capacityUnit) : SLOT_STATUS_LABELS[slot.status]}
                  <span className="ml-2 font-normal">
                    （予約 {slot.reservedCount} / 定員 {slot.capacity}
                    {slot.capacityUnit}）
                  </span>
                </dd>
              </div>
            </dl>
          </div>
          {isPastSlotDay(slot.startsAt, new Date(), shop.timezone) ? (
            // 終わった日の回には登録しない（サーバーでも止める）
            <Notice tone="warning" className="max-w-xl">
              終わった日の回のため、手動予約はできません。上の「回を選び直す」から、今日以降の回を選んでください。
            </Notice>
          ) : (
            <>
              {slot.startsAt.getTime() <= new Date().getTime() && (
                <Notice tone="warning" className="max-w-xl">
                  この回はすでに開始しています。当日の飛び込みなどを記録する場合だけ登録してください。
                </Notice>
              )}
              <ManualBookingForm
                slotId={slot.id}
                prices={prices}
                unit={slot.capacityUnit}
                includedGuests={slot.includedGuests}
                extraGuestPrice={slot.extraGuestPrice}
                maxGuests={slot.maxGuests}
                minPartySize={slot.minPartySize}
                remaining={remaining}
                isFull={slot.reservedCount >= slot.capacity}
                requireAges={slot.requireAges}
                today={localDate(new Date(), shop.timezone)}
                operators={operators.filter((o) => o.status !== 'suspended').map((o) => ({ id: o.id, name: o.name }))}
                defaultOperatorId={
                  operators.some((o) => o.id === slot.operatorId && o.status !== 'suspended') ? slot.operatorId : null
                }
                hasPaymentInstructions={
                  Boolean(shop.settings.paymentInstructions) || (await cardPaymentsActive(db, shop.id))
                }
                initialCustomer={
                  inquiry ? { name: inquiry.name, phone: inquiry.phone ?? '', email: inquiry.email } : undefined
                }
              />
            </>
          )}
        </div>
      );
    }
  }

  const menus = (await listMenusForAdmin(db, shop.id)).filter((m) => m.status !== 'archived');
  const menuId = isUuid(sp.menu) && menus.some((m) => m.id === sp.menu) ? sp.menu : menus[0]?.id;
  const now = new Date();
  const today = localDate(now, shop.timezone);
  const date = isDateString(sp.date) ? sp.date : today;
  // 終わった日（今日より前）の回は、選べないように出す（登録はサーバーでも止める）
  const pastDate = date < today;
  const slots = menuId ? await listSlotsForDate(db, { menuId, date, timezone: shop.timezone }) : [];
  const unit = menus.find((m) => m.id === menuId)?.capacityUnit ?? '名';
  // 事業者ごとにまとめる（一覧の並びは事業者の表示順）
  const groups = new Map<string, typeof menus>();
  for (const m of menus) {
    const key = m.operatorName ?? '組合直営';
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const dateLink = (d: string) =>
    withInquiry(`/admin/bookings/new?${new URLSearchParams({ menu: menuId ?? '', date: d })}`);

  return (
    <div className="space-y-4">
      <PageHeader
        title="手動予約"
        description="電話・LINE・店頭で受けた予約を登録します。プランと日付を選んでください。"
      />
      {inquiryNotice}
      <form
        action="/admin/bookings/new"
        className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end"
      >
        <SubmitOnChange />
        {inquiry && <input type="hidden" name="inquiry" value={inquiry.id} />}
        <label className="min-w-0 space-y-1 text-sm">
          <span className="block font-medium">プラン</span>
          <select name="menu" defaultValue={menuId} className={cn(SELECT_CLASS, 'w-full')}>
            {[...groups].map(([operator, items]) => (
              <optgroup key={operator} label={operator}>
                {items.map((m) => (
                  <option key={m.id} value={m.id}>
                    {splitPlanTitle(m.title).title}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">日付</span>
          <input type="date" name="date" defaultValue={date} className={cn(SELECT_CLASS, 'w-full')} />
        </label>
        <Button type="submit" variant="outline">
          回を表示
        </Button>
        <div className="flex flex-wrap gap-2 text-sm sm:col-span-3">
          {[
            ['今日', today],
            ['明日', addDays(today, 1)],
            ['あさって', addDays(today, 2)],
          ].map(([label, d]) => (
            <Link
              key={d}
              href={dateLink(d)}
              aria-current={date === d ? 'true' : undefined}
              className={cn(
                'inline-flex min-h-9 items-center rounded-full px-3 ring-1 pointer-coarse:min-h-11',
                date === d
                  ? 'bg-slate-900 font-semibold text-white ring-slate-900'
                  : 'text-slate-700 ring-slate-200 hover:bg-slate-50',
              )}
            >
              {label}
            </Link>
          ))}
        </div>
      </form>

      <section aria-labelledby="slots-title" className="space-y-2">
        <h2 id="slots-title" className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <CalendarDays aria-hidden className="size-4" />
          {formatDateLabel(zonedToUtc(date, '12:00', shop.timezone), shop.timezone)} の回
        </h2>
        {pastDate && slots.length > 0 && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            終わった日の回には、手動予約はできません。上の「今日」「明日」や日付で、今日以降の日を選んでください。
          </p>
        )}
        {slots.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600">
            この日にこのプランの回はありません。上の「明日」「あさって」や日付で、別の日を選んでください。
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {slots.map((s) => {
              const tone = occupancyTone(s, shop);
              // 開始済みの回も（当日の飛び込みなどのため）登録はできるが、見た目で分かるようにする
              const started = s.startsAt.getTime() <= now.getTime();
              const body = (
                <>
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-lg font-bold tabular-nums">{s.time}</span>
                    {started && <span className="text-xs font-semibold">開始済み</span>}
                  </span>
                  <span className="block text-sm font-semibold">
                    {s.status === 'open' ? occupancyText(s, unit) : SLOT_STATUS_LABELS[s.status]}
                    {/* 色だけでなく文字でも「残りわずか」を伝える */}
                    {tone === 'busy' && <span className="ml-1 text-xs">（わずか）</span>}
                  </span>
                  <span className="block text-xs tabular-nums">
                    予約 {s.reservedCount} / 定員 {s.capacity}
                  </span>
                </>
              );
              return (
                <li key={s.id}>
                  {s.status === 'open' && !pastDate ? (
                    <Link
                      href={withInquiry(`/admin/bookings/new?slot=${s.id}`)}
                      className={cn(
                        'block min-h-11 rounded-xl border p-3 transition hover:ring-2 hover:ring-sky-400',
                        TONE_STYLE[tone].cell,
                        started && 'border-dashed',
                      )}
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className={cn('rounded-xl border p-3', TONE_STYLE[tone].cell)} aria-disabled>
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-slate-500">満席の回も、定員超過の理由を入力すれば登録できます。</p>
      </section>
    </div>
  );
}
