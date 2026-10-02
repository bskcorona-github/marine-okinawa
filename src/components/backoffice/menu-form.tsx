'use client';

import { startTransition, useActionState, useState, type FormEvent } from 'react';
import { SELECT_CLASS } from '@/components/backoffice/field-styles';
import { StickySaveBar, useUnsavedChanges } from '@/components/backoffice/form-kit';
import { PlanImagesField, type UploadImageResult } from '@/components/backoffice/plan-images-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';
import { MENU_CATEGORY_LABELS, MENU_STATUS_LABELS } from '@/modules/booking/labels';
import type { AdminFormState as MenuFormState } from '@/lib/zod-ja';
import { isPerPerson } from '@/modules/catalog/capacity-unit';
import { SEASON_LABELS, type Season } from '@/modules/catalog/season';

/** 必須の欄の印（色だけでなく文字でも伝える） */
function RequiredMark() {
  return <span className="ml-1.5 rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-700">必須</span>;
}

export type MenuFormValues = {
  slug: string;
  status: keyof typeof MENU_STATUS_LABELS;
  category: keyof typeof MENU_CATEGORY_LABELS;
  durationMin: number;
  minAge: number | null;
  maxPartySize: number;
  minPartySize: number;
  bookingCutoffMin: number;
  cutoffPrevDayTime: string | null;
  operatorId: string | null;
  activityId: string | null;
  featured: boolean;
  requireAges: boolean;
  capacityUnit: '名' | '艇';
  title: string;
  description: string;
  meetingPoint: string;
  meetingAddress: string;
  meetingMapUrl: string;
  whatToBring: string;
  cancellationPolicy: string;
  weatherPolicy: string;
  summary: string;
  included: string;
  conditions: string;
  notes: string;
  images: string[];
  /** 料金（null は未入力。新しいプランは空欄から） */
  prices: { id?: string; label: string; price: number | null; season: string | null; meetingPoint: string | null }[];
  includedGuests: number | null;
  extraGuestPrice: number | null;
  maxGuests: number | null;
  /** 実施候補の事業者（予約ごとの受入確認で、照会先の候補に出す） */
  candidateIds: string[];
};

type Props = {
  action: (prev: MenuFormState, formData: FormData) => Promise<MenuFormState>;
  initial: MenuFormValues;
  operators: { id: string; name: string; status?: string }[];
  activities: { id: string; name: string }[];
  submitLabel: string;
  /** 今後の確定予約の件数（アーカイブにするときに警告する） */
  upcomingBookings?: number;
  /** 予約があるメニューは定員の単位（名／艇）を変えられない */
  unitLocked?: boolean;
  /**
   * operator：事業者画面。URL 名・公開状態・掲載元の事業者・おすすめ・実施候補は出さない（組合が決める）
   */
  mode?: 'admin' | 'operator';
  /** 写真のアップロード（組合・事業者それぞれの Server Action） */
  uploadImage: (formData: FormData) => Promise<UploadImageResult>;
  /** 公開中のプランの変更を申請するときの、組合へのひとこと（事業者画面だけ） */
  noteField?: { label: string; defaultValue: string };
  /** 一緒に送る値（フォームを開いたときのプランの更新日時など） */
  hiddenFields?: Record<string, string>;
};

type PriceRow = { key: string; id?: string; label: string; price: string; season: string; meetingPoint: string };

let rowSeq = 0;
const newKey = () => `row-${++rowSeq}`;

export function MenuForm({
  action,
  initial,
  operators,
  activities,
  submitLabel,
  upcomingBookings = 0,
  unitLocked = false,
  mode = 'admin',
  uploadImage,
  noteField,
  hiddenFields,
}: Props) {
  const admin = mode === 'admin';
  const [state, formAction, pending] = useActionState(action, { error: null });
  const { dirty, markDirty } = useUnsavedChanges();
  const [status, setStatus] = useState(initial.status);
  const [unit, setUnit] = useState(initial.capacityUnit);
  const [prices, setPrices] = useState<PriceRow[]>(() =>
    initial.prices.map((p) => ({
      key: newKey(),
      id: p.id,
      label: p.label,
      price: p.price === null ? '' : String(p.price),
      season: p.season ?? '',
      meetingPoint: p.meetingPoint ?? '',
    })),
  );

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  // 料金区分は state で持つので、変更したら未保存の印を付ける
  const changePrices = (next: (rows: PriceRow[]) => PriceRow[]) => {
    setPrices(next);
    markDirty();
  };
  const update = (key: string, patch: Partial<PriceRow>) =>
    changePrices((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  // 0 円の区分（無料の区分のときだけ。入れ忘れに気づけるように知らせる）
  const freeRows = prices.filter((r) => r.price.trim() !== '' && Number(r.price) === 0);

  return (
    <form method="post" onSubmit={onSubmit} onChange={markDirty} className="max-w-2xl space-y-6">
      {Object.entries(hiddenFields ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input
        type="hidden"
        name="prices"
        value={JSON.stringify(
          prices.map(({ id, label, price, season, meetingPoint }) => ({
            id,
            label,
            price,
            season: season || null,
            meetingPoint: meetingPoint || null,
          })),
        )}
      />
      <section className="space-y-3 rounded-lg border bg-white p-4">
        <h2 className="font-semibold">基本情報</h2>
        <div className="space-y-1">
          <Label htmlFor="title">
            プラン名
            <RequiredMark />
          </Label>
          <Input id="title" name="title" defaultValue={initial.title} required />
        </div>
        {admin && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="slug">
                  URL 名（半角英小文字・数字・ハイフン）
                  <RequiredMark />
                </Label>
                <Input id="slug" name="slug" defaultValue={initial.slug} required pattern="[a-z0-9]+(-[a-z0-9]+)*" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="status">公開状態</Label>
                <select
                  id="status"
                  name="status"
                  defaultValue={initial.status}
                  onChange={(e) => setStatus(e.target.value as MenuFormValues['status'])}
                  className={cn(SELECT_CLASS, 'w-full')}
                >
                  {Object.entries(MENU_STATUS_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {status !== 'published' && upcomingBookings > 0 && (
              <p
                role="status"
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
              >
                このプランには今後の予約が {upcomingBookings} 件あります。{MENU_STATUS_LABELS[status]}
                にすると新しい Web
                申込は受け付けませんが、入っている予約はそのまま残り、タイムテーブルにも表示されます。
              </p>
            )}
            <p className="text-xs text-slate-500">
              受付停止：ページは公開したまま、Web 申込だけを止めます（「在庫確認中」「準備中」などのとき）。
            </p>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="activityId">アクティビティ</Label>
            <select
              id="activityId"
              name="activityId"
              defaultValue={initial.activityId ?? ''}
              className={cn(SELECT_CLASS, 'w-full')}
            >
              <option value="">（未設定：アクティビティページに出ません）</option>
              {activities.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col justify-end gap-2 text-sm">
            {admin && (
              <label className="flex min-h-9 items-center gap-2">
                <input type="checkbox" name="featured" defaultChecked={initial.featured} className="size-4" />
                TOP の「おすすめ」に出す
              </label>
            )}
            <label className="flex min-h-9 items-center gap-2">
              <input type="checkbox" name="requireAges" defaultChecked={initial.requireAges} className="size-4" />
              申込で参加者全員の年齢を入力してもらう
            </label>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="category">カテゴリ</Label>
            <select
              id="category"
              name="category"
              defaultValue={initial.category}
              className={cn(SELECT_CLASS, 'w-full')}
            >
              {Object.entries(MENU_CATEGORY_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="durationMin">
              所要時間（分）
              <RequiredMark />
            </Label>
            <Input
              id="durationMin"
              name="durationMin"
              type="number"
              min={10}
              defaultValue={initial.durationMin}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="minAge">対象年齢（〜歳以上）</Label>
            <Input id="minAge" name="minAge" type="number" min={0} defaultValue={initial.minAge ?? ''} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="maxPartySize">
              1 予約の最大人数
              <RequiredMark />
            </Label>
            <Input
              id="maxPartySize"
              name="maxPartySize"
              type="number"
              min={1}
              defaultValue={initial.maxPartySize}
              required
            />
          </div>
          {/* 最少人数は人数で数えるプランだけ（貸切は 1 回 1 艇） */}
          {isPerPerson(unit) ? (
            <div className="space-y-1">
              <Label htmlFor="minPartySize">
                1 予約の最少人数
                <RequiredMark />
              </Label>
              <Input
                id="minPartySize"
                name="minPartySize"
                type="number"
                inputMode="numeric"
                min={1}
                defaultValue={initial.minPartySize}
                required
              />
            </div>
          ) : (
            <input type="hidden" name="minPartySize" value={1} />
          )}
          <div className="space-y-1">
            <Label htmlFor="bookingCutoffMin">
              Web 予約の締切（開始何分前）
              <RequiredMark />
            </Label>
            <Input
              id="bookingCutoffMin"
              name="bookingCutoffMin"
              type="number"
              min={0}
              defaultValue={initial.bookingCutoffMin}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cutoffPrevDayTime">または前日の締切時刻</Label>
            <Input
              id="cutoffPrevDayTime"
              name="cutoffPrevDayTime"
              type="time"
              defaultValue={initial.cutoffPrevDayTime?.slice(0, 5) ?? ''}
            />
          </div>
          {admin && (
            <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3 sm:col-span-2">
              <legend className="px-1 font-medium">実施事業者</legend>
              <div className="space-y-1">
                <Label htmlFor="operatorId">掲載元の事業者（このプランを実施する事業者）</Label>
                <select
                  id="operatorId"
                  name="operatorId"
                  defaultValue={initial.operatorId ?? ''}
                  className={cn(SELECT_CLASS, 'w-full sm:w-80')}
                >
                  <option value="">（なし）</option>
                  {operators.map((o) => (
                    <option key={o.id} value={o.id} disabled={o.status === 'suspended' && o.id !== initial.operatorId}>
                      {o.name}
                      {o.status === 'suspended' ? '（停止中）' : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-600">
                  事業者画面からこのプランを直せる事業者で、申込を受けたときに実施事業者として入ります（受入確認の回答や組合の選択で変わります）。
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">実施候補（受入確認を依頼できる事業者）</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {operators.map((o) => (
                    <label
                      key={o.id}
                      className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 has-checked:border-sky-600 has-checked:bg-sky-50"
                    >
                      <input
                        type="checkbox"
                        name="candidateId"
                        value={o.id}
                        defaultChecked={initial.candidateIds.includes(o.id)}
                        disabled={o.status === 'suspended' && !initial.candidateIds.includes(o.id)}
                        className="size-4"
                      />
                      <span>
                        {o.name}
                        {o.status === 'suspended' && (
                          <span className="ml-1 text-xs text-slate-600">
                            {initial.candidateIds.includes(o.id)
                              ? '（停止中のため受入確認の候補に出ません。外すと、停止を解除するまで選び直せません）'
                              : '（停止中は選べません）'}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-slate-600">
                  未設定なら、停止中でないすべての事業者を候補に出します。候補を選んだときは、予約の初期値の事業者も自動で候補に入ります。
                </p>
              </div>
            </fieldset>
          )}
          <div className="space-y-1">
            <Label htmlFor="capacityUnit">定員の単位</Label>
            <select
              id="capacityUnit"
              name="capacityUnit"
              defaultValue={initial.capacityUnit}
              onChange={(e) => setUnit(e.target.value as MenuFormValues['capacityUnit'])}
              disabled={unitLocked}
              aria-describedby={unitLocked ? 'capacityUnit-locked' : undefined}
              className={cn(SELECT_CLASS, 'w-full disabled:bg-slate-100 disabled:text-slate-500')}
            >
              <option value="名">名（人数）</option>
              <option value="艇">艇（貸切）</option>
            </select>
            {/* 無効にした select は送信されないので、同じ値を hidden で送る */}
            {unitLocked && <input type="hidden" name="capacityUnit" value={initial.capacityUnit} />}
            {unitLocked && (
              <p id="capacityUnit-locked" className="text-xs text-slate-500">
                予約があるため変更できません
              </p>
            )}
          </div>
        </div>
        {!isPerPerson(unit) && (
          <div className="grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
            <p className="text-sm font-medium sm:col-span-2">貸切の乗船人数と追加料金</p>
            <div className="space-y-1">
              <Label htmlFor="includedGuests">基本料金に含まれる人数（名）</Label>
              <Input
                id="includedGuests"
                name="includedGuests"
                type="number"
                inputMode="numeric"
                min={1}
                defaultValue={initial.includedGuests ?? ''}
                placeholder="例：10"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="extraGuestPrice">超えた 1 名あたりの追加料金（円）</Label>
              <Input
                id="extraGuestPrice"
                name="extraGuestPrice"
                type="number"
                inputMode="numeric"
                min={0}
                defaultValue={initial.extraGuestPrice ?? ''}
                placeholder="例：8000"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="maxGuests">乗船人数の上限（名）</Label>
              <Input
                id="maxGuests"
                name="maxGuests"
                type="number"
                inputMode="numeric"
                min={1}
                defaultValue={initial.maxGuests ?? ''}
                placeholder="例：35"
              />
            </div>
            <p className="text-xs text-slate-500 sm:col-span-2">
              お客様が入力した乗船人数が基本の人数を超えると、超えた人数 ×
              追加料金を合計に足します。空欄なら追加料金はありません。
            </p>
          </div>
        )}
        <p className="text-xs text-slate-500">
          前日の締切時刻を入れると「参加日の前日のその時刻まで」になり、開始何分前の設定より優先されます。
        </p>
      </section>

      <section className="space-y-3 rounded-lg border bg-white p-4">
        <h2 className="font-semibold">説明（お客様向けページに表示）</h2>
        <p className="text-xs text-slate-500">
          持ち物・料金に含まれるものは、1 行に 1 つ書くと箇条書きで表示されます。
        </p>
        <div className="space-y-1">
          <Label htmlFor="summary">一覧用の紹介文（短め）</Label>
          <Textarea id="summary" name="summary" rows={2} defaultValue={initial.summary} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="description">説明文</Label>
          <Textarea id="description" name="description" rows={6} defaultValue={initial.description} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="meetingPoint">集合場所（名称・集合時刻・注意文）</Label>
          <Textarea id="meetingPoint" name="meetingPoint" rows={3} defaultValue={initial.meetingPoint} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="meetingAddress">集合場所の住所（地図を表示します）</Label>
            <Input id="meetingAddress" name="meetingAddress" defaultValue={initial.meetingAddress} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="meetingMapUrl">地図の URL（任意・Google マップなど）</Label>
            <Input
              id="meetingMapUrl"
              name="meetingMapUrl"
              type="url"
              defaultValue={initial.meetingMapUrl}
              placeholder="https://maps.app.goo.gl/..."
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="whatToBring">持ち物（1 行に 1 つ）</Label>
          <Textarea id="whatToBring" name="whatToBring" rows={3} defaultValue={initial.whatToBring} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="included">料金に含まれるもの（1 行に 1 つ）</Label>
          <Textarea id="included" name="included" rows={3} defaultValue={initial.included} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="conditions">参加条件</Label>
          <Textarea id="conditions" name="conditions" rows={3} defaultValue={initial.conditions} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="notes">注意事項</Label>
          <Textarea id="notes" name="notes" rows={4} defaultValue={initial.notes} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="weatherPolicy">天候等による中止（安全基準・中止のときの扱い）</Label>
          <Textarea id="weatherPolicy" name="weatherPolicy" rows={3} defaultValue={initial.weatherPolicy} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cancellationPolicy">このプランのキャンセル規定</Label>
          <Textarea
            id="cancellationPolicy"
            name="cancellationPolicy"
            rows={3}
            defaultValue={initial.cancellationPolicy}
          />
          <p className="text-xs text-slate-500">
            {admin
              ? 'キャンセル料の率と共通の規定は「設定」から自動で表示します。ここには率を書かず、このプランだけの決まり（遅刻のときの扱いなど）を書いてください。'
              : 'キャンセル料の率と共通の規定は組合が決め、自動で表示します。ここには率を書かず、このプランだけの決まり（遅刻のときの扱いなど）を書いてください。'}
          </p>
        </div>
        <div id="images" className="space-y-1">
          <p className="font-medium">写真（1 枚目がメインの写真）</p>
          <PlanImagesField
            name="images"
            initial={initial.images}
            upload={uploadImage}
            allowUrl={admin}
            onChange={markDirty}
          />
        </div>
      </section>

      <section id="prices" tabIndex={-1} className="space-y-3 rounded-lg border bg-white p-4 outline-none">
        <h2 className="font-semibold">料金区分</h2>
        {prices.map((row, index) => (
          // スマホでは 1 行目に区分名、2 行目に料金・季節・削除を並べる
          <div
            key={row.key}
            className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-end gap-2 border-b border-slate-100 pb-3 last:border-0 sm:flex sm:flex-wrap sm:border-0 sm:pb-0"
          >
            <div className="col-span-3 space-y-1 sm:flex-1">
              <Label htmlFor={`price-label-${row.key}`}>
                区分名
                <RequiredMark />
              </Label>
              <Input
                id={`price-label-${row.key}`}
                value={row.label}
                onChange={(e) => update(row.key, { label: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1 sm:w-32">
              <Label htmlFor={`price-amount-${row.key}`}>
                料金（円・税込）
                <RequiredMark />
              </Label>
              <Input
                id={`price-amount-${row.key}`}
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="例：8000"
                value={row.price}
                onChange={(e) => update(row.key, { price: e.target.value })}
                aria-describedby={row.price === '0' ? `price-free-${row.key}` : undefined}
                required
              />
            </div>
            <div className="space-y-1 sm:w-28">
              <Label htmlFor={`price-season-${row.key}`}>季節</Label>
              <select
                id={`price-season-${row.key}`}
                value={row.season}
                onChange={(e) => update(row.key, { season: e.target.value })}
                className={cn(SELECT_CLASS, 'w-full')}
              >
                <option value="">通年</option>
                {(Object.keys(SEASON_LABELS) as Season[]).map((s) => (
                  <option key={s} value={s}>
                    {SEASON_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              variant="ghost"
              disabled={prices.length <= 1}
              onClick={() => changePrices((rows) => rows.filter((r) => r.key !== row.key))}
              aria-label={`${index + 1} 行目の料金区分を削除`}
            >
              削除
            </Button>
            {!isPerPerson(unit) && (
              <div className="col-span-3 space-y-1 sm:w-full sm:basis-full">
                <Label htmlFor={`price-meeting-${row.key}`}>集合場所（このコースだけ違う場合）</Label>
                <Input
                  id={`price-meeting-${row.key}`}
                  value={row.meetingPoint}
                  onChange={(e) => update(row.key, { meetingPoint: e.target.value })}
                  placeholder="空欄ならプランの集合場所"
                />
              </div>
            )}
          </div>
        ))}
        {freeRows.length > 0 && (
          <p
            id={`price-free-${freeRows[0].key}`}
            role="status"
            className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"
          >
            料金が 0 円の区分があります（{freeRows.map((r) => r.label || '名前なし').join('・')}
            ）。無料で受け付ける区分（幼児など）のときだけ 0 にしてください。
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            changePrices((rows) => [...rows, { key: newKey(), label: '', price: '', season: '', meetingPoint: '' }])
          }
        >
          料金区分を追加
        </Button>
      </section>

      {noteField && (
        <section className="space-y-1 rounded-lg border bg-white p-4">
          <Label htmlFor="note">{noteField.label}</Label>
          <Textarea
            id="note"
            name="note"
            rows={2}
            maxLength={500}
            defaultValue={noteField.defaultValue}
            placeholder="例：繁忙期の料金を改定しました"
          />
        </section>
      )}
      <StickySaveBar
        pending={pending}
        dirty={dirty}
        error={state.error}
        issues={state.issues}
        submitLabel={submitLabel}
      />
    </form>
  );
}
