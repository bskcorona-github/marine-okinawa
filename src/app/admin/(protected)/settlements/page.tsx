import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { ConfirmDialog } from '@/components/backoffice/confirm-dialog';
import { PRIMARY_TRIGGER_CLASS, SELECT_CLASS } from '@/components/backoffice/field-styles';
import { Notice, PageHeader } from '@/components/backoffice/page-header';
import { SubmitButton } from '@/components/backoffice/submit-button';
import { Button, buttonVariants } from '@/components/ui/button';
import { db } from '@/db';
import { addDays, addMonths, formatIsoDateLabel, formatMonthLabel, localDate, monthOf } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import { ownValue } from '@/lib/own';
import { cn } from '@/lib/utils';
import { isMonthString } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import {
  countAwaitingSettlement,
  listOperatorsWithoutBankAccount,
  listSettlements,
  payoutDateOf,
  SETTLEMENT_ERROR_LABELS,
  settlementStatusLabel,
} from '@/modules/settlement/settlements';
import { getShopById } from '@/modules/shop/shops';
import { buildSettlementsAction, confirmAllSettlementsAction } from './actions';
import { SETTLEMENT_STATUS_TONE } from '@/components/backoffice/settlement-status-tone';

export const metadata = { title: '精算' };

export default async function SettlementsPage({ searchParams }: PageProps<'/admin/settlements'>) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const shop = await getShopById(db, admin.shopId);
  const thisMonth = monthOf(localDate(new Date(), shop.timezone));
  // 精算を作れるのは締めた月（先月まで）。初めて開いたときは先月
  const lastClosed = addMonths(thisMonth, -1);
  const period = isMonthString(sp.period) && sp.period <= lastClosed ? sp.period : lastClosed;
  // まだ精算に入れられない予約は、精算を作る前から知らせる（作ったあとで気づいて作り直さなくてよいように）
  const [rows, awaiting] = await Promise.all([
    listSettlements(db, { shopId: shop.id, period }),
    countAwaitingSettlement(db, { shopId: shop.id, period }),
  ]);
  const payout = payoutDateOf(period, shop.settings.payoutDay);
  // 事業者へ振り込む額と、事業者から受け取る額（現地払いの手数料）は分けて出す（差し引きの合計は振る額ではない）
  const payTotal = rows.reduce((sum, r) => sum + Math.max(r.payoutAmount, 0), 0);
  const receiveTotal = rows.reduce((sum, r) => sum + Math.max(-r.payoutAmount, 0), 0);
  const grossTotal = rows.reduce((sum, r) => sum + r.grossAmount, 0);
  const commissionTotal = rows.reduce((sum, r) => sum + r.commissionAmount, 0);
  const drafts = rows.filter((r) => r.status === 'draft' && r.itemCount + r.adjustmentCount > 0);
  // まとめて確定の前に知らせる：精算口座（振込先）をまだ登録していない事業者（組合から振り込む精算だけ）
  const missingBank = await listOperatorsWithoutBankAccount(db, {
    shopId: shop.id,
    operatorIds: drafts.filter((d) => d.payoutAmount > 0).map((d) => d.operatorId),
  });
  const awaitingTotal = awaiting.awaitingReport + awaiting.awaitingVerification;
  // まだ精算に入れられない予約を、予約台帳で同じ範囲（いちばん早い参加日〜この月の末日）で開く
  const lastDay = addDays(`${addMonths(period, 1)}-01`, -1);
  const awaitingHref = (status: string) =>
    `/admin/bookings?${new URLSearchParams({
      status,
      ...(awaiting.firstDate ? { date: awaiting.firstDate, to: lastDay } : {}),
      sort: 'date',
    })}`;
  const progress = [
    { label: '下書き', count: rows.filter((r) => r.status === 'draft').length },
    { label: '確定（振込待ち）', count: rows.filter((r) => r.status === 'confirmed').length },
    { label: '振込・入金済み', count: rows.filter((r) => r.status === 'paid').length },
  ];
  const error = typeof sp.error === 'string' ? ownValue<string>(SETTLEMENT_ERROR_LABELS, sp.error) : null;
  const monthHref = (p: string) => `/admin/settlements?period=${p}`;

  // まとめて確定の件数は数字として読む（URL の値をそのまま文に入れない）
  const count = (v: unknown) => (typeof v === 'string' && /^\d{1,4}$/.test(v) ? Number(v) : null);
  const confirmedAll = count(sp.confirmedAll);
  const skipped = count(sp.skipped) ?? 0;
  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader
        title="精算"
        description={`事業者ごとの月次精算です。参加日がその月までの、実績確認済みの予約と確定後の取消のキャンセル料を対象にします（手数料率 ${shop.settings.commissionRate}%。「設定」で変えられます）。`}
        actions={
          rows.length > 0 && (
            <a href={`/admin/settlements/export?period=${period}`} className={buttonVariants({ variant: 'outline' })}>
              CSV 出力
            </a>
          )
        }
      />
      {/* 月の切り替え（日報・集計と同じ形） */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm">
        <div className="flex items-center gap-1">
          <Link
            href={monthHref(addMonths(period, -1))}
            className={buttonVariants({ variant: 'outline', size: 'icon' })}
            aria-label="前の月"
          >
            <ChevronLeft aria-hidden />
          </Link>
          <p className="min-w-32 text-center font-semibold text-slate-900 tabular-nums">{formatMonthLabel(period)}</p>
          {period < lastClosed ? (
            <Link
              href={monthHref(addMonths(period, 1))}
              className={buttonVariants({ variant: 'outline', size: 'icon' })}
              aria-label="次の月"
            >
              <ChevronRight aria-hidden />
            </Link>
          ) : (
            <span className="size-9 pointer-coarse:size-11" aria-hidden />
          )}
        </div>
        <form className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-600">月を選ぶ</span>
            <input type="month" name="period" defaultValue={period} max={lastClosed} className={SELECT_CLASS} />
          </label>
          <Button type="submit" variant="outline">
            この月を見る
          </Button>
        </form>
      </div>

      {typeof sp.built === 'string' && (
        <Notice tone="success">
          {formatMonthLabel(period)}の精算を計算しました（下書き {sp.built} 件）。確定・振込済みの精算は変えていません。
        </Notice>
      )}
      {confirmedAll !== null && (
        <Notice tone={skipped ? 'warning' : 'success'}>
          下書き {confirmedAll} 件を確定し、事業者画面に明細を出しました。
          {skipped
            ? `${skipped} 件は、計算し直したら数字が変わったなどのため、下書きのまま残しました。開いて金額を確かめてから確定してください。`
            : ''}
        </Notice>
      )}
      {sp.removed && (
        <Notice tone="warning">
          確定の前に計算し直したところ、その事業者の明細がなくなったため、精算を消しました（返金・取消などで対象の予約がなくなりました）。
        </Notice>
      )}
      {awaitingTotal > 0 && (
        <Notice tone="warning">
          参加日がこの月までで、まだ精算に入れられない予約があります。先に済ませてから、精算を作る（計算し直す）と入ります。
          <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {awaiting.awaitingReport > 0 && (
              <Link
                href={awaitingHref('awaiting_report')}
                className="inline-flex min-h-9 items-center font-semibold underline pointer-coarse:min-h-11"
              >
                催行報告待ち {awaiting.awaitingReport} 件
              </Link>
            )}
            {awaiting.awaitingVerification > 0 && (
              <Link
                href={awaitingHref('completed')}
                className="inline-flex min-h-9 items-center font-semibold underline pointer-coarse:min-h-11"
              >
                実績確認待ち {awaiting.awaitingVerification} 件
              </Link>
            )}
          </span>
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">
              {formatMonthLabel(period)}の精算（支払日 {formatIsoDateLabel(payout, { year: false })}）
            </h2>
            <p className="text-xs text-slate-600">
              下書きは何度でも計算し直せます。確定すると事業者画面に明細を出し、計算し直しません。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <form action={buildSettlementsAction}>
              <input type="hidden" name="period" value={period} />
              <SubmitButton variant={rows.length ? 'outline' : 'default'} pendingLabel="計算中…">
                {rows.length ? '下書きを計算し直す' : 'この月の精算を作る'}
              </SubmitButton>
            </form>
            {drafts.length > 0 && (
              <form action={confirmAllSettlementsAction}>
                <input type="hidden" name="period" value={period} />
                {drafts.map((d) => (
                  <span key={d.id}>
                    <input type="hidden" name="id" value={d.id} />
                    <input
                      type="hidden"
                      name={`seen:${d.id}`}
                      value={`${d.payoutAmount}:${d.itemCount}:${d.adjustmentCount}`}
                    />
                  </span>
                ))}
                <ConfirmDialog
                  tone="default"
                  triggerLabel={`下書き ${drafts.length} 件をまとめて確定…`}
                  triggerClassName={PRIMARY_TRIGGER_CLASS}
                  title={`${formatMonthLabel(period)}の下書き ${drafts.length} 件を確定しますか？`}
                  confirmLabel="精算をまとめて確定する"
                  pendingLabel="確定しています…"
                >
                  <p>次の精算を確定し、事業者画面に明細を出します。振込の前なら、1 件ずつ確定を取り消せます。</p>
                  {awaitingTotal > 0 && (
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
                      参加日がこの月までで、まだ精算に入っていない予約があります（
                      {[
                        awaiting.awaitingReport > 0 && `催行報告待ち ${awaiting.awaitingReport} 件`,
                        awaiting.awaitingVerification > 0 && `実績確認待ち ${awaiting.awaitingVerification} 件`,
                      ]
                        .filter(Boolean)
                        .join('・')}
                      ）。このまま確定すると、それらはあとの月の精算に入ります。
                    </p>
                  )}
                  {missingBank.length > 0 && (
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
                      精算口座（振込先）がまだ登録されていない事業者があります：
                      <strong>{missingBank.map((o) => o.name).join('・')}</strong>
                      。確定はできますが、振り込む前に事業者の画面で登録してください。
                    </p>
                  )}
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {drafts.map((d) => (
                      <li key={d.id} className="flex justify-between gap-3 px-3 py-2 tabular-nums">
                        <span>{d.operatorName}</span>
                        <span className="font-semibold">
                          {d.payoutAmount >= 0
                            ? `支払う ${formatYen(d.payoutAmount)}`
                            : `受け取る ${formatYen(-d.payoutAmount)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-slate-600">
                    確定の前に 1 件ずつ計算し直し、数字が変わっていたものは確定せずにお知らせします。
                  </p>
                </ConfirmDialog>
              </form>
            )}
          </div>
        </div>
        {rows.length > 0 && (
          <p className="flex flex-wrap gap-2 text-sm" aria-label="この月の進み具合">
            {progress.map((p) => (
              <span key={p.label} className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                {p.label} <strong className="tabular-nums">{p.count}</strong> 件
              </span>
            ))}
          </p>
        )}
        {rows.length === 0 ? (
          <p className="text-sm text-slate-600">
            この月の精算はまだありません。「この月の精算を作る」を押すと、事業者ごとの下書きを作ります。
          </p>
        ) : (
          <>
            {/* スマホでは 1 件ずつのカード（支払う額・受け取る額を大きく出す） */}
            <ul className="space-y-2 md:hidden">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/admin/settlements/${r.id}`}
                    className="block rounded-lg border border-slate-200 p-3 text-sm hover:bg-sky-50/60"
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0 font-semibold text-sky-800 underline underline-offset-2">
                        {r.operatorName}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
                          SETTLEMENT_STATUS_TONE[r.status],
                        )}
                      >
                        {settlementStatusLabel(r.status, r.payoutAmount)}
                      </span>
                    </span>
                    <span className="mt-1 block text-lg font-bold text-slate-900 tabular-nums">
                      {r.payoutAmount >= 0
                        ? `支払う ${formatYen(r.payoutAmount)}`
                        : `受け取る ${formatYen(-r.payoutAmount)}`}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-600 tabular-nums">
                      {r.itemCount} 件{r.adjustmentCount > 0 && `（調整 ${r.adjustmentCount} 件）`}・対象額{' '}
                      {formatYen(r.grossAmount)}・手数料 {formatYen(r.commissionAmount)}
                    </span>
                  </Link>
                </li>
              ))}
              <li className="rounded-lg bg-slate-50 p-3 text-sm tabular-nums">
                <span className="block font-semibold text-slate-900">
                  合計：支払う {formatYen(payTotal)}
                  {receiveTotal > 0 && `・受け取る ${formatYen(receiveTotal)}`}
                </span>
                <span className="block text-xs text-slate-600">
                  対象額 {formatYen(grossTotal)}・手数料 {formatYen(commissionTotal)}
                </span>
              </li>
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-slate-50 text-xs text-slate-700">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left">
                      事業者
                    </th>
                    <th scope="col" className="px-3 py-2 text-left">
                      状態
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      件数
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      対象額
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      手数料
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      事業者へ支払う額
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      事業者から受け取る額
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <th scope="row" className="px-3 py-2 text-left font-medium">
                        <Link
                          href={`/admin/settlements/${r.id}`}
                          className="inline-flex min-h-9 items-center text-sky-800 underline underline-offset-2 pointer-coarse:min-h-11"
                        >
                          {r.operatorName}
                        </Link>
                      </th>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            'rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
                            SETTLEMENT_STATUS_TONE[r.status],
                          )}
                        >
                          {settlementStatusLabel(r.status, r.payoutAmount)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.itemCount}
                        {r.adjustmentCount > 0 && (
                          <span className="block text-xs text-amber-800">調整 {r.adjustmentCount} 件</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatYen(r.grossAmount)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatYen(r.commissionAmount)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {r.payoutAmount >= 0 ? formatYen(r.payoutAmount) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {r.payoutAmount < 0 ? formatYen(-r.payoutAmount) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                  <tr>
                    <th scope="row" colSpan={3} className="px-3 py-2 text-left">
                      合計
                    </th>
                    <td className="px-3 py-2 text-right tabular-nums">{formatYen(grossTotal)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatYen(commissionTotal)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatYen(payTotal)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatYen(receiveTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="space-y-1 text-xs text-slate-600">
              <p>
                「事業者から受け取る額」は、現地払いの予約の手数料が事業者への支払いより多い月に、事業者から組合へ払ってもらう額です。
              </p>
              <p>
                対象額は、実績確認済みの予約とキャンセル料を精算の月にまとめた額です。「分析」の取扱高（参加日の月の、確定済みの予約の支払総額）とは数え方が違うため、同じ月でも合いません。手数料の合計は、分析の「手数料」（下書きの精算は「見込み」）と同じです。
                <Link
                  href={`/admin/analytics?from=${period}&to=${period}&tab=overview`}
                  className="ml-1 inline-flex min-h-9 items-center text-sky-800 underline pointer-coarse:min-h-11"
                >
                  この月の分析を見る
                </Link>
              </p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
