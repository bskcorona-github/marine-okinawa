import { Phone } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import { Notice, PageHeader, Panel } from '@/components/admin/page-header';
import { SubmitButton } from '@/components/admin/submit-button';
import { BookingStatusBadge } from '@/components/admin/status-badge';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { db } from '@/db';
import { formatDateLabel, localDate, localTime } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import { ownValue } from '@/lib/own';
import { cn } from '@/lib/utils';
import { isUuid } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import {
  BOOKING_SOURCE_LABELS,
  BOOKING_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  SLOT_STATUS_LABELS,
} from '@/modules/booking/labels';
import { listSlotBookings } from '@/modules/booking/queries';
import { SEAT_HOLDING_STATUSES } from '@/modules/booking/status';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { formatPhoneForDisplay } from '@/modules/customer/normalize';
import { remainingSeats } from '@/modules/inventory/availability';
import { getSlotForAdmin } from '@/modules/inventory/queries';
import { getShopById } from '@/modules/shop/shops';
import { occupancyTone, TONE_STYLE } from '../../occupancy';
import { WEATHER_TARGET_STATUSES } from '@/modules/booking/weather-cancel-slot';
import { changeCapacityAction, closeSlotAction, reopenSlotAction, weatherCancelSlotAction } from './actions';

export const metadata = { title: '回の詳細' };

/** 枠を押さえている予約（未確定の申込も含む。取消・天候中止は薄く出す） */
const ACTIVE = new Set<string>(SEAT_HOLDING_STATUSES);

const SAVED: Record<string, string> = {
  capacity: '定員を変更しました。',
  closed: 'この回を休止しました。新規の予約は受け付けません。',
  reopened: '休止を解除しました。Web でも予約を受け付けます。',
  weather: 'この回を天候中止にしました。',
};

const WEATHER_TARGETS = new Set<string>(WEATHER_TARGET_STATUSES);

export default async function SlotPage({ params, searchParams }: PageProps<'/admin/slots/[id]'>) {
  const admin = await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const [shop, slot] = await Promise.all([
    getShopById(db, admin.shopId),
    getSlotForAdmin(db, { shopId: admin.shopId, slotId: id }),
  ]);
  if (!slot) notFound();
  const bookings = await listSlotBookings(db, { shopId: admin.shopId, slotId: id });
  const active = bookings.filter((b) => ACTIVE.has(b.status));
  const date = localDate(slot.startsAt, shop.timezone);
  const unit = slot.capacityUnit;
  const remaining = remainingSeats(slot.capacity, slot.reservedCount);
  const tone = occupancyTone(slot, shop);
  const started = slot.startsAt.getTime() <= new Date().getTime();
  const scheduleHref = `/admin/menus/${slot.menuId}/schedule`;
  const saved = ownValue(SAVED, sp.saved);
  const weatherCount = Number(sp.count) || 0;
  const mailFailed = Number(sp.mailFailed) || 0;
  // 一括の天候中止で止める予約と、全額返金で記録する入金済みの予約
  const weatherTargets = bookings.filter((b) => WEATHER_TARGETS.has(b.status));
  const weatherConfirmed = weatherTargets.filter((b) => b.status === 'confirmed');
  const weatherPaid = weatherTargets.filter(
    (b) => b.paymentStatus === 'paid' || b.paymentStatus === 'partially_refunded',
  );
  const refundTotal = weatherPaid.reduce((sum, b) => sum + (b.paymentAmount ?? 0) - (b.refundedAmount ?? 0), 0);
  const slotLabel = `${formatDateLabel(slot.startsAt, shop.timezone)} ${localTime(slot.startsAt, shop.timezone)}`;
  // 天候中止のあと、メールで知らせられなかった（メールアドレスがない）予約は、電話で伝える
  const needPhone =
    sp.saved === 'weather'
      ? bookings.filter((b) => (b.status === 'cancelled' || b.status === 'weather_cancelled') && !b.hasEmail)
      : [];
  const paymentNote = (b: (typeof bookings)[number]) =>
    b.paymentStatus === 'paid' || b.paymentStatus === 'partially_refunded'
      ? `入金済み ${formatYen(b.paymentAmount ?? 0)}`
      : b.paymentMethod === 'onsite'
        ? '現地払い'
        : '未入金';
  // タイムテーブルの表示（週表示・絞り込み）のまま戻れるようにする。他サイトへの移動は受け付けない
  const backHref =
    typeof sp.back === 'string' && sp.back.startsWith('/admin/timetable?') ? sp.back : `/admin/timetable?date=${date}`;

  const errors: Record<string, ReactNode> = {
    capacity: '定員は 0〜500 の整数で入力してください。',
    BELOW_RESERVED: `定員は予約済みの人数（${slot.reservedCount}${unit}）より少なくできません。新規の予約を止めたい場合は「この回を休止」を使ってください。`,
    NOT_OPEN: 'この回の状態が変わったため、操作できませんでした。画面を確認してください。',
    INVALID_TRANSITION: 'この回の状態が変わったため、天候中止にできませんでした。画面を確認してください。',
    REFUND_REQUIRED: '返金の記録が合わない予約があるため、天候中止にできませんでした。予約ごとに確認してください。',
    INVALID_INPUT: '入力を確認してください。',
    STILL_CLOSED: (
      <>
        この回は、終日の休業日またはルールの変更で休止になっているため、ここでは解除できません。
        <Link href={scheduleHref} className="ml-1 font-semibold underline">
          回の設定
        </Link>
        で変更してください。
      </>
    ),
  };
  const error = ownValue(errors, sp.error);

  return (
    <div className="max-w-5xl">
      <PageHeader
        back={{ href: backHref, label: 'タイムテーブルへ' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="whitespace-nowrap tabular-nums">
              {formatDateLabel(slot.startsAt, shop.timezone)} {localTime(slot.startsAt, shop.timezone)}
            </span>
            {/* 開始済みの回は「受付中」を出さない（もう予約は受け付けないため） */}
            {!(started && slot.status === 'open') && (
              <span
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-sm font-semibold whitespace-nowrap',
                  slot.status === 'open' ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-200 text-slate-700',
                )}
              >
                {SLOT_STATUS_LABELS[slot.status]}
              </span>
            )}
            {started && (
              <span className="rounded-full border border-dashed border-slate-500 px-2.5 py-0.5 text-sm font-semibold whitespace-nowrap text-slate-700">
                開始済み
              </span>
            )}
          </span>
        }
        description={splitPlanTitle(slot.menuTitle).title}
        actions={
          slot.status === 'open' && (
            <Link href={`/admin/bookings/new?slot=${slot.id}`} className={buttonVariants()}>
              この回に手動予約
            </Link>
          )
        }
      />

      {/* スマホでは予約者の一覧（名簿と電話番号）を先に出し、定員・休止の操作はその下にする */}
      <div className="flex flex-col gap-4">
        {saved && (
          <Notice tone="success">
            {saved}
            {sp.saved === 'weather' &&
              (weatherCount > 0
                ? `${weatherCount} 件の予約を天候中止・取消にしました。入金済みの予約は全額を返金予定にしています。返金したら予約ごとに記録してください。`
                : '止める予約はありませんでした。')}
          </Notice>
        )}
        {needPhone.length > 0 && (
          <Notice tone="warning">
            メールアドレスがないため、次のお客様にはお電話でお伝えください：
            <ul className="mt-1 list-disc pl-5">
              {needPhone.map((b) => (
                <li key={b.id}>
                  {b.contactName} 様{b.contactPhone && `（${formatPhoneForDisplay(b.contactPhone) || b.contactPhone}）`}
                </li>
              ))}
            </ul>
          </Notice>
        )}
        {sp.saved === 'weather' && mailFailed > 0 && (
          <Notice tone="warning">
            {mailFailed} 件のメールを送れませんでした。予約ごとの画面で送り直すか、お電話などでお伝えください。
          </Notice>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        {slot.reservedCount > slot.capacity && (
          <Notice tone="error">
            定員を {slot.reservedCount - slot.capacity}
            {unit}超えて予約が入っています。
          </Notice>
        )}
        {slot.status === 'closed' && active.length > 0 && (
          <Notice tone="warning">
            休止中ですが、予約が {active.length}{' '}
            件残っています（休止しても予約は取り消されません）。お客様へ連絡するか、下の「この回の予約を一括で天候中止にする」を使ってください。
          </Notice>
        )}

        <div className="order-2 grid gap-4 md:order-none md:grid-cols-3">
          <div
            className={cn(
              'rounded-xl border p-4',
              started ? 'border-slate-200 bg-slate-50 text-slate-600' : TONE_STYLE[tone].cell,
            )}
          >
            <p className="text-xs font-semibold">予約状況{started && '（開始済み）'}</p>
            <p className="mt-1 text-3xl font-bold whitespace-nowrap tabular-nums">
              残り {remaining}
              <span className="text-base font-semibold">{unit}</span>
            </p>
            <p className="mt-1 text-sm tabular-nums">
              予約 <strong data-testid="reserved">{slot.reservedCount}</strong>
              {unit} / 定員 {slot.capacity}
              {unit}
              {!started && `（${TONE_STYLE[tone].label}）`}
            </p>
          </div>

          <Panel title="定員" className="md:col-span-1">
            {slot.status === 'open' ? (
              <form action={changeCapacityAction.bind(null, slot.id)} className="flex items-end gap-2">
                <input type="hidden" name="back" value={backHref} />
                <label className="space-y-1 text-sm">
                  <span className="block text-slate-600">この回だけ変更（{unit}）</span>
                  <Input
                    name="capacity"
                    type="number"
                    inputMode="numeric"
                    min={slot.reservedCount}
                    max={500}
                    defaultValue={slot.capacity}
                    className="w-24"
                  />
                </label>
                <SubmitButton variant="outline" pendingLabel="保存中…">
                  変更
                </SubmitButton>
              </form>
            ) : (
              <p className="text-sm text-slate-500">休止中は変更できません。</p>
            )}
            <p className="mt-2 text-xs text-slate-500">
              予約済みの人数より少なくはできません。曜日ごとの定員は
              <Link href={scheduleHref} className="mx-0.5 underline">
                回の設定
              </Link>
              で変更します。
            </p>
          </Panel>

          <Panel title={slot.status === 'open' ? '休止' : '休止の解除'}>
            {slot.status === 'open' && started ? (
              <p className="text-sm text-slate-600">開始済みの回は休止できません。</p>
            ) : slot.status === 'open' ? (
              <form action={closeSlotAction.bind(null, slot.id)}>
                <input type="hidden" name="back" value={backHref} />
                <ConfirmDialog
                  triggerLabel="この回を休止"
                  title="この回を休止しますか？"
                  confirmLabel="休止する"
                  triggerClassName="w-full"
                >
                  <ul className="list-disc space-y-1 rounded-lg bg-slate-50 p-3 pl-7">
                    <li>新規の予約（Web・手動）を受け付けなくなります。</li>
                    {active.length > 0 ? (
                      <li className="font-semibold text-red-700">
                        予約が {active.length} 件（{slot.reservedCount}
                        {unit}）あります。予約はキャンセルされないため、お客様への連絡が必要です。
                      </li>
                    ) : (
                      <li>この回に予約はありません。</li>
                    )}
                    <li>あとから「休止を解除」で元に戻せます。</li>
                  </ul>
                </ConfirmDialog>
              </form>
            ) : slot.status === 'weather_cancelled' ? (
              <p className="text-sm text-slate-600">天候中止の回です。ここでは受付を再開できません。</p>
            ) : (
              <form action={reopenSlotAction.bind(null, slot.id)}>
                <input type="hidden" name="back" value={backHref} />
                <SubmitButton variant="outline" className="w-full" pendingLabel="保存中…">
                  休止を解除
                </SubmitButton>
              </form>
            )}
            <p className="mt-2 text-xs text-slate-500">
              {slot.status === 'weather_cancelled'
                ? '予約の返金は、予約ごとの画面で記録します。'
                : slot.status === 'open' && started
                  ? '当日の天候中止は、下の「この回の予約を一括で天候中止にする」から行えます。'
                  : slot.status === 'open'
                    ? '新規の予約だけを止めるときに使います（入っている予約はそのまま）。天候で中止するときは下の一括の天候中止を使います。'
                    : '終日の休業日で休止している場合は、回の設定で変更します。'}
            </p>
          </Panel>
        </div>

        <Panel title={`予約者（${active.length} 件・${slot.reservedCount}${unit}）`} className="order-1 md:order-none">
          {bookings.length === 0 ? (
            <p className="text-sm text-slate-500">予約はまだありません</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {bookings.map((b) => {
                const phone = formatPhoneForDisplay(b.contactPhone);
                return (
                  <li
                    key={b.id}
                    className={cn(
                      'flex flex-wrap items-center gap-x-4 gap-y-1 py-3',
                      !ACTIVE.has(b.status) && 'opacity-60',
                    )}
                  >
                    <Link
                      href={`/admin/bookings/${b.id}`}
                      className="min-w-0 flex-1 basis-60 rounded-md hover:bg-slate-50"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900 underline-offset-2 hover:underline">
                          {b.contactName} 様
                        </span>
                        <BookingStatusBadge status={b.status} />
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500 tabular-nums">
                        {b.bookingNo} ・ {BOOKING_SOURCE_LABELS[b.source]} ・ {formatYen(b.totalAmount)}
                        {b.paymentStatus && `（${PAYMENT_STATUS_LABELS[b.paymentStatus]}）`}
                      </span>
                    </Link>
                    <span className="w-16 text-right font-semibold tabular-nums">
                      {b.partySize}
                      {unit}
                      {b.guestCount && (
                        <span className="block text-xs font-normal text-slate-500">{b.guestCount}名</span>
                      )}
                    </span>
                    {phone ? (
                      <a
                        href={`tel:${b.contactPhone}`}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm text-sky-800 tabular-nums hover:bg-sky-50"
                      >
                        <Phone aria-hidden className="size-4" />
                        {phone}
                      </a>
                    ) : (
                      <span className="min-w-32 text-sm text-slate-400">電話番号なし</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {slot.status !== 'weather_cancelled' && (
          <Panel
            title="天候による中止"
            description="天候・海況でこの回をまるごと中止するときに使います。予約ごとに取り消す必要はありません。"
            className="order-3 md:order-none"
          >
            <form action={weatherCancelSlotAction.bind(null, slot.id)}>
              <input type="hidden" name="back" value={backHref} />
              <ConfirmDialog
                tone="danger"
                triggerLabel="この回の予約を一括で天候中止にする"
                title={`${slotLabel} ${splitPlanTitle(slot.menuTitle).title} を天候中止にしますか？`}
                confirmLabel="天候中止にする"
                pendingLabel="処理中…"
              >
                <ul className="list-disc space-y-1 rounded-lg bg-slate-50 p-3 pl-7">
                  <li>この回を「天候中止」にし、新しい予約を受け付けなくなります。</li>
                  {weatherTargets.length === 0 ? (
                    <li>止める予約はありません。</li>
                  ) : (
                    <>
                      <li>
                        対象の予約（{weatherTargets.length} 件）：
                        <ul className="mt-1 space-y-0.5 text-xs">
                          {weatherTargets.map((b) => (
                            <li key={b.id}>
                              {b.contactName} 様 ・ {BOOKING_STATUS_LABELS[b.status]} ・ {paymentNote(b)}
                              {!b.hasEmail && (
                                <span className="font-semibold text-amber-800"> ・ メールなし（電話が必要）</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </li>
                      <>
                        {weatherConfirmed.length > 0 && (
                          <li>予約確定 {weatherConfirmed.length} 件を「天候中止」にします。</li>
                        )}
                        {weatherTargets.length > weatherConfirmed.length && (
                          <li>
                            未確定の申込 {weatherTargets.length - weatherConfirmed.length}{' '}
                            件を「取消（区分：天候）」にします。
                          </li>
                        )}
                        {weatherPaid.length > 0 && (
                          <li>
                            入金済みの {weatherPaid.length} 件は、全額（合計 {formatYen(refundTotal)}
                            ）を返金予定として記録します。キャンセル料を取る場合は、先に予約ごとに取り消してください。
                          </li>
                        )}
                      </>
                    </>
                  )}
                  <li className="font-semibold text-red-700">元に戻せません（この回の受付も再開できません）。</li>
                </ul>
                <label className="block space-y-1">
                  <span className="block font-medium">中止の理由（組合用・お客様には送りません）</span>
                  <Textarea name="note" rows={2} maxLength={500} placeholder="例：強風・高波のため" />
                </label>
                {weatherTargets.length > 0 && (
                  <>
                    <label className="flex items-start gap-2">
                      <input type="checkbox" name="notify" value="on" defaultChecked className="mt-0.5 size-4" />
                      <span>お客様に天候中止のお知らせメールを送る（メールアドレスのある予約だけ）</span>
                    </label>
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        name="notifyOperator"
                        value="on"
                        defaultChecked
                        className="mt-0.5 size-4"
                      />
                      <span>実施事業者にもメールで知らせる（確定済み・照会していた予約）</span>
                    </label>
                  </>
                )}
              </ConfirmDialog>
            </form>
          </Panel>
        )}
      </div>
    </div>
  );
}
