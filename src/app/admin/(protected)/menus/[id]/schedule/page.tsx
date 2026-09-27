import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { db } from '@/db';
import { addDays, formatDateLabel, localDate, toHhmm, zonedToUtc } from '@/lib/dates';
import { isUuid } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import { SLOT_STATUS_LABELS, WEEKDAY_LABELS } from '@/modules/booking/labels';
import { getMenuForAdmin } from '@/modules/catalog/menus';
import { getTimetable } from '@/modules/inventory/queries';
import { listScheduleRules, listUpcomingExceptions } from '@/modules/schedule/rules';
import { getShopById } from '@/modules/shop/shops';
import { addExceptionAction, addRuleAction, deleteExceptionAction, deleteRuleAction } from './actions';

export const metadata = { title: '回の設定' };

const EXCEPTION_LABELS = { closed: '休止', capacity_override: '定員変更', extra_slot: '臨時の回' } as const;

export default async function SchedulePage({ params, searchParams }: PageProps<'/admin/menus/[id]/schedule'>) {
  const admin = await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const [shop, menu] = await Promise.all([getShopById(db, admin.shopId), getMenuForAdmin(db, admin.shopId, id)]);
  if (!menu) notFound();

  const now = new Date();
  const today = localDate(now, shop.timezone);
  const [rules, exceptions, preview] = await Promise.all([
    listScheduleRules(db, menu.id),
    listUpcomingExceptions(db, { menuId: menu.id, timezone: shop.timezone, now }),
    getTimetable(db, { shopId: shop.id, timezone: shop.timezone, fromDate: today, days: 14 }),
  ]);
  const previewSlots = preview.find((r) => r.menuId === menu.id)?.slots ?? [];
  const previewDates = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const label = (d: string) => formatDateLabel(zonedToUtc(d, '12:00', shop.timezone), shop.timezone);
  const error = typeof sp.error === 'string' ? sp.error : null;

  return (
    <div className="space-y-6">
      <Link href={`/admin/menus/${menu.id}`} className="text-sm text-slate-600">
        ← メニューの編集へ
      </Link>
      <h1 className="text-xl font-bold">回の設定：{menu.translation.title}</h1>
      {sp.created && (
        <p className="rounded bg-emerald-50 p-3 text-sm text-emerald-900">
          メニューを作成しました。開始時刻と定員を登録してください。
        </p>
      )}
      {sp.saved && (
        <p className="rounded bg-emerald-50 p-3 text-sm text-emerald-900">保存し、今後 180 日分の回に反映しました。</p>
      )}
      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {typeof sp.closedBooked === 'string' && (
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">
          予約の入っている回が {sp.closedBooked}{' '}
          件、休止になりました。予約はキャンセルされていないため、お客様への連絡が必要です（タイムテーブルで灰色の回）。
        </p>
      )}

      <section className="space-y-3 rounded-lg border bg-white p-4">
        <h2 className="font-semibold">定期の回（ルール）</h2>
        <ul className="divide-y text-sm">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center justify-between py-2">
              <span>
                <strong className="tabular-nums">{toHhmm(r.startTime)}</strong>　定員 {r.capacity} 名
                {r.weekdays.map((w) => WEEKDAY_LABELS[w]).join('・')}　{r.validFrom} 〜 {r.validTo ?? '期限なし'}
              </span>
              <form action={deleteRuleAction.bind(null, menu.id, r.id)}>
                <Button type="submit" variant="ghost" size="sm">
                  削除
                </Button>
              </form>
            </li>
          ))}
          {rules.length === 0 && <li className="py-2 text-slate-500">まだ登録されていません</li>}
        </ul>
        <form action={addRuleAction.bind(null, menu.id)} className="grid gap-3 border-t pt-3 text-sm sm:grid-cols-5">
          <label className="space-y-1">
            <span className="block font-medium">開始時刻</span>
            <Input type="time" name="startTime" required />
          </label>
          <label className="space-y-1">
            <span className="block font-medium">定員</span>
            <Input type="number" name="capacity" min={1} defaultValue={10} required />
          </label>
          <label className="space-y-1">
            <span className="block font-medium">開始日</span>
            <Input type="date" name="validFrom" defaultValue={today} required />
          </label>
          <label className="space-y-1">
            <span className="block font-medium">終了日（任意）</span>
            <Input type="date" name="validTo" />
          </label>
          <fieldset className="space-y-1 sm:col-span-5">
            <legend className="font-medium">曜日</legend>
            <div className="flex flex-wrap gap-3">
              {WEEKDAY_LABELS.map((w, i) => (
                <label key={w} className="flex items-center gap-1">
                  <input type="checkbox" name="weekdays" value={i} defaultChecked /> {w}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="sm:col-span-5">
            <Button type="submit">ルールを追加</Button>
          </div>
        </form>
      </section>

      <section className="space-y-3 rounded-lg border bg-white p-4">
        <h2 className="font-semibold">例外（休業日・定員変更・臨時の回）</h2>
        <ul className="divide-y text-sm">
          {exceptions.map((e) => (
            <li key={e.id} className="flex items-center justify-between py-2">
              <span>
                {e.date} {e.startTime ? toHhmm(e.startTime) : '終日'}　{EXCEPTION_LABELS[e.type]}
                {e.capacity !== null && `（定員 ${e.capacity} 名）`}
              </span>
              <form action={deleteExceptionAction.bind(null, menu.id, e.id)}>
                <Button type="submit" variant="ghost" size="sm">
                  削除
                </Button>
              </form>
            </li>
          ))}
          {exceptions.length === 0 && <li className="py-2 text-slate-500">今後の例外はありません</li>}
        </ul>
        <form
          action={addExceptionAction.bind(null, menu.id)}
          className="grid gap-3 border-t pt-3 text-sm sm:grid-cols-5"
        >
          <label className="space-y-1">
            <span className="block font-medium">日付</span>
            <Input type="date" name="date" min={today} required />
          </label>
          <label className="space-y-1">
            <span className="block font-medium">種類</span>
            <select name="type" className="h-8 w-full rounded border px-2" defaultValue="closed">
              {Object.entries(EXCEPTION_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block font-medium">時刻（空欄＝終日）</span>
            <Input type="time" name="startTime" />
          </label>
          <label className="space-y-1">
            <span className="block font-medium">定員（休止以外）</span>
            <Input type="number" name="capacity" min={0} />
          </label>
          <div className="self-end">
            <Button type="submit">例外を追加</Button>
          </div>
        </form>
      </section>

      <section className="space-y-3 rounded-lg border bg-white p-4">
        <h2 className="font-semibold">今後 14 日の回</h2>
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          {previewDates.map((d) => {
            const daySlots = previewSlots.filter((s) => s.date === d);
            return (
              <li key={d} className="flex gap-2">
                <span className="w-32 shrink-0 text-slate-600">{label(d).replace(/^\d+年/, '')}</span>
                <span>
                  {daySlots.length === 0
                    ? '—'
                    : daySlots
                        .map((s) => `${s.time}(${s.status === 'open' ? s.capacity : SLOT_STATUS_LABELS[s.status]})`)
                        .join('　')}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
