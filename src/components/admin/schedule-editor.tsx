import Link from 'next/link';
import type { ReactNode } from 'react';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import { SELECT_CLASS } from '@/components/admin/field-styles';
import { Notice, PageHeader, Panel } from '@/components/admin/page-header';
import { SubmitButton } from '@/components/admin/submit-button';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { db } from '@/db';
import { addDays, formatDateLabel, localDate, toHhmm, zonedToUtc } from '@/lib/dates';
import { ownValue } from '@/lib/own';
import { cn } from '@/lib/utils';
import { SLOT_STATUS_LABELS, WEEKDAY_LABELS } from '@/modules/booking/labels';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import type { AdminMenu } from '@/modules/catalog/menus';
import { getTimetable } from '@/modules/inventory/queries';
import {
  exceptionInputSchema,
  listScheduleRules,
  listUpcomingExceptions,
  previewExceptionAddition,
  previewRuleAddition,
  previewRuleCapacityChange,
  previewScheduleDeletions,
  ruleInputSchema,
  type ScheduleImpact,
} from '@/modules/schedule/rules';
import { exceptionHasTarget, overlappingRuleTimes } from '@/modules/schedule/generate';
import type { getShopById } from '@/modules/shop/shops';

const EXCEPTION_LABELS = { closed: '休止', capacity_override: '定員変更', extra_slot: '臨時の回' } as const;

const EXCEPTION_DELETE_EFFECT = {
  closed: '休止していた回が、ルールどおり受付中に戻ります。',
  capacity_override: 'この回の定員がルールの定員に戻ります。予約済みの人数より少なくなる場合は定員超過になります。',
  extra_slot: '臨時の回がなくなります。',
} as const;

const ERRORS: Record<string, string> = {
  date: '日付を確認してください（終了日は開始日以降にしてください）。',
  weekdays: '曜日を 1 つ以上選んでください。',
  startTime: '開始時刻を入力してください（臨時の回には開始時刻が必要です）。',
  capacity: '定員を 0〜500 の整数で入力してください（休止以外は必須です）。',
  pastDate: '過去の日付には例外を追加できません。',
  input: '入力内容を確認してください。',
};

/** 小さいチェックボックスも、指で押しやすいようにラベル全体を大きくする */
const CHECK_LABEL = 'flex min-h-9 items-center gap-1.5 rounded-md px-1 pointer-coarse:min-h-11';

type Shop = Awaited<ReturnType<typeof getShopById>>;

/** 回の設定の操作（管理画面・事業者画面それぞれの Server Action。権限の確認はそれぞれで行う） */
export type ScheduleActions = {
  addRule: (menuId: string, formData: FormData) => Promise<void>;
  updateRuleCapacity: (menuId: string, ruleId: string, formData: FormData) => Promise<void>;
  deleteRule: (menuId: string, ruleId: string) => Promise<void>;
  addException: (menuId: string, formData: FormData) => Promise<void>;
  deleteException: (menuId: string, exceptionId: string) => Promise<void>;
};

/**
 * 回の設定の画面（定期の回のルール・例外・今後 14 日の回）。管理画面と事業者画面で共通。
 * page は画面の URL（確認・やめるの戻り先）、intro は画面の上に出す案内
 */
export async function ScheduleEditor({
  menu,
  shop,
  sp,
  page,
  back,
  title,
  actions,
  intro,
}: {
  menu: AdminMenu;
  shop: Shop;
  sp: Record<string, string | string[] | undefined>;
  page: string;
  back: { href: string; label: string };
  title: string;
  actions: ScheduleActions;
  intro?: ReactNode;
}) {
  const now = new Date();
  const today = localDate(now, shop.timezone);
  const [rules, exceptions, preview, impacts] = await Promise.all([
    listScheduleRules(db, menu.id),
    listUpcomingExceptions(db, { menuId: menu.id, timezone: shop.timezone, now }),
    getTimetable(db, { shopId: shop.id, timezone: shop.timezone, fromDate: today, days: 14 }),
    previewScheduleDeletions(db, { menuId: menu.id, timezone: shop.timezone, now }),
  ]);
  const unit = menu.capacityUnit;
  const weekdays = (list: number[]) => (list.length === 7 ? '毎日' : list.map((w) => WEEKDAY_LABELS[w]).join('・'));
  const previewSlots = preview.find((r) => r.menuId === menu.id)?.slots ?? [];
  const previewDates = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const label = (d: string) => formatDateLabel(zonedToUtc(d, '12:00', shop.timezone), shop.timezone);
  const error = ownValue(ERRORS, sp.error);
  const noImpact: ScheduleImpact = { bookedSlots: 0, people: 0, overBooked: 0 };

  // 保存前の確認（例外の追加・ルールの追加・ルールの定員変更）。URL の値は検証し直し、影響の件数もここで数え直す
  const cancelLink = (
    <Link href={page} className={buttonVariants({ variant: 'outline' })}>
      やめる
    </Link>
  );
  const confirmButton = (text: string) => (
    <SubmitButton className="bg-red-600 text-white hover:bg-red-700" pendingLabel="保存中…">
      {text}
    </SubmitButton>
  );
  let pending: { what: string; impact: ScheduleImpact; form: ReactNode } | null = null;
  if (sp.confirm === 'exception') {
    const parsed = exceptionInputSchema.safeParse({
      date: sp.date,
      startTime: sp.startTime || null,
      type: sp.type,
      capacity: sp.capacity || null,
    });
    if (parsed.success) {
      const ex = parsed.data;
      pending = {
        what: `${label(ex.date)} ${ex.startTime ?? '終日'}の「${EXCEPTION_LABELS[ex.type]}」を追加すると、`,
        impact: await previewExceptionAddition(db, { shopId: shop.id, menuId: menu.id, now, input: ex }),
        form: (
          <form action={actions.addException.bind(null, menu.id)} className="flex flex-wrap gap-2">
            <input type="hidden" name="date" value={ex.date} />
            <input type="hidden" name="startTime" value={ex.startTime ?? ''} />
            <input type="hidden" name="type" value={ex.type} />
            <input type="hidden" name="capacity" value={ex.capacity ?? ''} />
            <input type="hidden" name="confirmed" value="1" />
            {confirmButton('このまま追加する')}
            {cancelLink}
          </form>
        ),
      };
    }
  } else if (sp.confirm === 'ruleAdd') {
    const parsed = ruleInputSchema.safeParse({
      validFrom: sp.validFrom,
      validTo: sp.validTo || null,
      weekdays: typeof sp.weekdays === 'string' ? sp.weekdays.split(',') : [],
      startTime: sp.startTime,
      capacity: sp.capacity,
    });
    if (parsed.success) {
      const rule = parsed.data;
      pending = {
        what: `${rule.startTime}（${weekdays(rule.weekdays)}・定員 ${rule.capacity}${unit}）のルールを追加すると、`,
        impact: await previewRuleAddition(db, { shopId: shop.id, menuId: menu.id, now, input: rule }),
        form: (
          <form action={actions.addRule.bind(null, menu.id)} className="flex flex-wrap gap-2">
            <input type="hidden" name="validFrom" value={rule.validFrom} />
            <input type="hidden" name="validTo" value={rule.validTo ?? ''} />
            {rule.weekdays.map((w) => (
              <input key={w} type="hidden" name="weekdays" value={w} />
            ))}
            <input type="hidden" name="startTime" value={rule.startTime} />
            <input type="hidden" name="capacity" value={rule.capacity} />
            <input type="hidden" name="confirmed" value="1" />
            {confirmButton('このまま追加する')}
            {cancelLink}
          </form>
        ),
      };
    }
  } else if (sp.confirm === 'ruleCapacity') {
    const rule = rules.find((r) => r.id === sp.ruleId);
    const capacity = Number(sp.capacity);
    if (rule && Number.isInteger(capacity) && capacity >= 1 && capacity <= 500) {
      pending = {
        what: `${toHhmm(rule.startTime)} のルールの定員を ${capacity}${unit} にすると、`,
        impact: await previewRuleCapacityChange(db, {
          shopId: shop.id,
          menuId: menu.id,
          ruleId: rule.id,
          capacity,
          now,
        }),
        form: (
          <form action={actions.updateRuleCapacity.bind(null, menu.id, rule.id)} className="flex flex-wrap gap-2">
            <input type="hidden" name="capacity" value={capacity} />
            <input type="hidden" name="confirmed" value="1" />
            {confirmButton('このまま変更する')}
            {cancelLink}
          </form>
        ),
      };
    }
  }
  const overlapping = overlappingRuleTimes(rules);

  return (
    <div className="max-w-4xl">
      <PageHeader back={back} title={title} description={splitPlanTitle(menu.translation.title).title} />
      <div className="space-y-4">
        {sp.created && <Notice tone="success">プランを作成しました。開始時刻と定員を登録してください。</Notice>}
        {intro}
        {sp.saved && <Notice tone="success">保存し、今後 180 日分の回に反映しました。</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        {typeof sp.closedBooked === 'string' && (
          <Notice tone="warning">
            予約の入っている回が {sp.closedBooked}{' '}
            件、休止になりました。予約はキャンセルされていないため、お客様への連絡が必要です（タイムテーブルで赤い点線の回）。
          </Notice>
        )}

        {pending && (
          <div role="alert" className="space-y-3 rounded-xl border-2 border-red-300 bg-red-50 p-4 text-sm text-red-900">
            <p className="font-semibold">
              {pending.what}
              {pending.impact.bookedSlots > 0 &&
                `予約の入っている回が ${pending.impact.bookedSlots} 件（${pending.impact.people}${unit}）休止になります。`}
              {pending.impact.overBooked > 0 &&
                `定員より予約が多い回（定員超過）が ${pending.impact.overBooked} 件できます。`}
              {pending.impact.bookedSlots === 0 && pending.impact.overBooked === 0 && '予約への影響はありません。'}
            </p>
            {(pending.impact.bookedSlots > 0 || pending.impact.overBooked > 0) && (
              <p>予約はキャンセルされないため、必要に応じてお客様へ連絡してください。このまま保存しますか？</p>
            )}
            {pending.form}
          </div>
        )}
        {typeof sp.overBooked === 'string' && (
          <Notice tone="warning">
            定員より予約が多い回（定員超過）が {sp.overBooked}{' '}
            件あります。タイムテーブルの赤い回を確認し、必要に応じてお客様へ連絡してください。
          </Notice>
        )}

        {overlapping.length > 0 && (
          <Notice tone="warning">
            {overlapping.join('・')}{' '}
            のルールが、同じ曜日・期間で重なっています。重なる日は、開始日が新しいルール（開始日が同じならあとから追加したルール）の定員を使います。
          </Notice>
        )}
        <Panel title="定期の回（ルール）" description="曜日と開始時刻ごとの回です。今後 180 日分を自動で作ります。">
          <ul className="divide-y divide-slate-100 text-sm">
            {rules.map((r) => {
              const impact = impacts.rules[r.id] ?? noImpact;
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <strong className="text-base tabular-nums">{toHhmm(r.startTime)}</strong>
                    <span>{weekdays(r.weekdays)}</span>
                    <span className="text-slate-500">
                      {label(r.validFrom)} 〜 {r.validTo ? label(r.validTo) : '期限なし'}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <form
                      action={actions.updateRuleCapacity.bind(null, menu.id, r.id)}
                      className="flex items-center gap-1"
                    >
                      <label className="flex items-center gap-1.5">
                        <span className="text-slate-600">定員</span>
                        <Input
                          type="number"
                          name="capacity"
                          inputMode="numeric"
                          min={1}
                          max={500}
                          defaultValue={r.capacity}
                          className="w-20"
                          aria-label={`${toHhmm(r.startTime)} の定員`}
                        />
                        <span className="text-slate-600">{unit}</span>
                      </label>
                      <SubmitButton variant="outline" pendingLabel="保存中…">
                        変更
                      </SubmitButton>
                    </form>
                    <form action={actions.deleteRule.bind(null, menu.id, r.id)}>
                      <ConfirmDialog
                        triggerLabel="削除"
                        title={`${toHhmm(r.startTime)} のルールを削除しますか？`}
                        confirmLabel="削除する"
                      >
                        <ul className="list-disc space-y-1 rounded-lg bg-slate-50 p-3 pl-7">
                          <li>
                            このルールで作られていた今後の回がなくなります（別のルールで同じ時刻がある日は残ります）。
                          </li>
                          {impact.bookedSlots > 0 ? (
                            <li className="font-semibold text-red-700">
                              予約の入っている回が {impact.bookedSlots} 件（{impact.people}
                              {unit}
                              ）あり、それらは休止になります。予約はキャンセルされないため、お客様への連絡が必要です。
                            </li>
                          ) : (
                            <li>予約の入っている回には影響しません。</li>
                          )}
                          {impact.overBooked > 0 && (
                            <li className="font-semibold text-red-700">
                              定員より予約が多い回（定員超過）が {impact.overBooked} 件できます。
                            </li>
                          )}
                          <li>定員を変えるだけなら、削除せずに「変更」を使ってください。</li>
                        </ul>
                      </ConfirmDialog>
                    </form>
                  </span>
                </li>
              );
            })}
            {rules.length === 0 && <li className="py-2 text-slate-500">まだ登録されていません</li>}
          </ul>
          <form
            action={actions.addRule.bind(null, menu.id)}
            className="mt-3 grid gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-4"
          >
            <p className="font-semibold sm:col-span-4">ルールを追加</p>
            <label className="space-y-1">
              <span className="block font-medium">開始時刻</span>
              <Input type="time" name="startTime" required />
            </label>
            <label className="space-y-1">
              <span className="block font-medium">定員（{unit}）</span>
              <Input type="number" name="capacity" inputMode="numeric" min={1} defaultValue={10} required />
            </label>
            <label className="space-y-1">
              <span className="block font-medium">開始日</span>
              <Input type="date" name="validFrom" defaultValue={today} required />
            </label>
            <label className="space-y-1">
              <span className="block font-medium">終了日（任意）</span>
              <Input type="date" name="validTo" />
            </label>
            <fieldset className="space-y-1 sm:col-span-4">
              <legend className="font-medium">曜日</legend>
              <div className="flex flex-wrap gap-x-2">
                {WEEKDAY_LABELS.map((w, i) => (
                  <label key={w} className={CHECK_LABEL}>
                    <input type="checkbox" name="weekdays" value={i} defaultChecked className="size-4" /> {w}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="sm:col-span-4">
              <SubmitButton pendingLabel="追加中…">ルールを追加</SubmitButton>
            </div>
          </form>
        </Panel>

        <Panel
          title="例外（休業日・定員変更・臨時の回）"
          description="台風などで終日休むときは、時刻を空欄にして「休止」を追加します。"
        >
          <ul className="divide-y divide-slate-100 text-sm">
            {exceptions.map((e) => {
              const impact = impacts.exceptions[e.id] ?? noImpact;
              return (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="flex flex-wrap items-baseline gap-x-3">
                    <span className="tabular-nums">{label(e.date).replace(/^\d+年/, '')}</span>
                    <span className="tabular-nums">{e.startTime ? toHhmm(e.startTime) : '終日'}</span>
                    <strong>{EXCEPTION_LABELS[e.type]}</strong>
                    {e.capacity !== null && (
                      <span>
                        定員 {e.capacity}
                        {unit}
                      </span>
                    )}
                    {!exceptionHasTarget(e, rules, exceptions) && (
                      <span className="text-xs text-slate-500">該当の回なし（削除しても影響はありません）</span>
                    )}
                  </span>
                  <form action={actions.deleteException.bind(null, menu.id, e.id)}>
                    <ConfirmDialog
                      triggerLabel="削除"
                      tone={e.type === 'closed' ? 'default' : 'danger'}
                      title="この例外を削除しますか？"
                      confirmLabel="削除する"
                    >
                      <p>{EXCEPTION_DELETE_EFFECT[e.type]}</p>
                      {impact.overBooked > 0 && (
                        <p className="font-semibold text-red-700">
                          定員より予約が多い回（定員超過）が {impact.overBooked} 件できます。
                        </p>
                      )}
                      {impact.bookedSlots > 0 && (
                        <p className="font-semibold text-red-700">
                          予約の入っている回が {impact.bookedSlots} 件（{impact.people}
                          {unit}）あり、休止になります。予約はキャンセルされないため、お客様への連絡が必要です。
                        </p>
                      )}
                    </ConfirmDialog>
                  </form>
                </li>
              );
            })}
            {exceptions.length === 0 && <li className="py-2 text-slate-500">今後の例外はありません</li>}
          </ul>
          <form
            action={actions.addException.bind(null, menu.id)}
            className="mt-3 grid gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-5"
          >
            <p className="font-semibold sm:col-span-5">例外を追加</p>
            <label className="space-y-1">
              <span className="block font-medium">日付</span>
              <Input type="date" name="date" min={today} required />
            </label>
            <label className="space-y-1">
              <span className="block font-medium">種類</span>
              <select name="type" className={cn(SELECT_CLASS, 'w-full')} defaultValue="closed">
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
              <Input type="number" name="capacity" inputMode="numeric" min={0} />
            </label>
            <div className="self-end">
              <SubmitButton pendingLabel="確認中…">例外を追加</SubmitButton>
            </div>
            <p className="text-xs text-slate-500 sm:col-span-5">
              予約の入っている回が休止になる場合は、追加する前に件数を表示して確認します。
            </p>
          </form>
        </Panel>

        <Panel title="今後 14 日の回">
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {previewDates.map((d) => {
              const daySlots = previewSlots.filter((s) => s.date === d);
              return (
                <li key={d} className="flex gap-2">
                  <span className="w-28 shrink-0 text-slate-600">{label(d).replace(/^\d+年/, '')}</span>
                  <span className="flex flex-wrap gap-x-3 gap-y-0.5">
                    {daySlots.length === 0
                      ? '—'
                      : daySlots.map((s) => (
                          <span key={s.id} className="whitespace-nowrap tabular-nums">
                            {s.time}（{s.status === 'open' ? `定員 ${s.capacity}${unit}` : SLOT_STATUS_LABELS[s.status]}
                            ）
                          </span>
                        ))}
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
