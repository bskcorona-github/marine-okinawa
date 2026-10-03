'use client';

import { startTransition, useActionState, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { SELECT_CLASS } from '@/components/backoffice/field-styles';
import { StickySaveBar, useUnsavedChanges } from '@/components/backoffice/form-kit';
import { PlanImagesField, type UploadImageResult } from '@/components/backoffice/plan-images-field';
import { RequiredMark } from '@/components/backoffice/required-mark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';
import { MENU_CATEGORY_LABELS, MENU_STATUS_LABELS } from '@/modules/booking/labels';
import type { AdminFormState as MenuFormState } from '@/lib/zod-ja';
import { isPerPerson } from '@/modules/catalog/capacity-unit';
import { SEASON_LABELS, type Season } from '@/modules/catalog/season';

/** フォームの区切り（見出しつきの枠。目次のリンクから飛べるよう id を付ける） */
function FormSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} tabIndex={-1} className="scroll-mt-6 space-y-3 rounded-lg border bg-white p-4 outline-none">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-slate-600">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** 「開始の◯分前」を、時間でも読めるようにする（例：120 → 2 時間前） */
function minutesLabel(value: string): string {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 0) return '';
  if (minutes < 60) return `${minutes} 分前`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 時間 ${rest} 分前` : `${hours} 時間前`;
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
  /** category を渡すと、アクティビティを選んだときに「種類（アイコン・色）」をそのアクティビティに合わせる */
  activities: { id: string; name: string; category?: string }[];
  submitLabel: string;
  /** 今後の確定予約の件数（掲載を終えるときに警告する） */
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
  /** 料金の「季節」の下に出す、繁忙期の日付の決め方の案内（管理画面では事業者の繁忙期の期間へのリンク） */
  seasonHint?: ReactNode;
  /** ページのアドレスの見本の頭（例：https://example.com/ja/menus/）。管理画面だけ */
  publicUrlBase?: string;
};

type PriceRow = { key: string; id?: string; label: string; price: string; season: string; meetingPoint: string };

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
  seasonHint,
  publicUrlBase = '/ja/menus/',
}: Props) {
  const admin = mode === 'admin';
  const [state, formAction, pending] = useActionState(action, { error: null });
  const { dirty, markDirty } = useUnsavedChanges();
  const [status, setStatus] = useState(initial.status);
  const [unit, setUnit] = useState(initial.capacityUnit);
  const [slug, setSlug] = useState(initial.slug);
  const [category, setCategory] = useState(initial.category);
  // 締切の決め方：開始の◯分前まで（minutes）か、前日の◯時まで（prevDay）
  const [cutoffMode, setCutoffMode] = useState<'minutes' | 'prevDay'>(
    initial.cutoffPrevDayTime ? 'prevDay' : 'minutes',
  );
  const [cutoffMinutes, setCutoffMinutes] = useState(String(initial.bookingCutoffMin));
  const [prevDayTime, setPrevDayTime] = useState(initial.cutoffPrevDayTime?.slice(0, 5) ?? '18:00');
  // 行の key はサーバーとブラウザで同じになるよう、最初の行は位置から、追加した行は続きの番号で作る
  const nextKey = useRef(initial.prices.length);
  const [prices, setPrices] = useState<PriceRow[]>(() =>
    initial.prices.map((p, index) => ({
      key: `row-${index}`,
      id: p.id,
      label: p.label,
      price: p.price === null ? '' : String(p.price),
      season: p.season ?? '',
      meetingPoint: p.meetingPoint ?? '',
    })),
  );
  const slugError = state.issues?.some((issue) => issue.field === 'slug') ?? false;

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
  const toc = [
    { href: '#sec-basic', label: '基本' },
    { href: '#sec-capacity', label: '人数と定員' },
    { href: '#sec-cutoff', label: '予約の締切' },
    ...(admin ? [{ href: '#sec-operators', label: '実施事業者' }] : []),
    { href: '#sec-description', label: '説明' },
    { href: '#sec-images', label: '写真' },
    { href: '#prices', label: '料金' },
  ];

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
      <nav aria-label="フォームの項目" className="flex flex-wrap gap-2 text-sm">
        {toc.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className="inline-flex min-h-9 items-center rounded-full bg-white px-3 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 pointer-coarse:min-h-11"
          >
            {item.label}
          </a>
        ))}
      </nav>

      <FormSection id="sec-basic" title="基本">
        <div className="space-y-1">
          <Label htmlFor="title">
            プラン名
            <RequiredMark />
          </Label>
          <Input id="title" name="title" defaultValue={initial.title} required />
        </div>
        {admin && (
          <div className="space-y-1">
            <Label htmlFor="status">公開状態</Label>
            <select
              id="status"
              name="status"
              defaultValue={initial.status}
              onChange={(e) => setStatus(e.target.value as MenuFormValues['status'])}
              aria-describedby="status-hint"
              className={cn(SELECT_CLASS, 'w-full sm:w-64')}
            >
              {Object.entries(MENU_STATUS_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <p id="status-hint" className="text-xs text-slate-600">
              受付停止：ページは公開したまま、Web 申込だけを止めます（「在庫確認中」「準備中」などのとき）。
              {MENU_STATUS_LABELS.archived}：サイトから外します（入っている予約はそのまま残ります）。
            </p>
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
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="activityId">アクティビティ</Label>
            <select
              id="activityId"
              name="activityId"
              defaultValue={initial.activityId ?? ''}
              onChange={(e) => {
                // 種類（アイコン・色）をアクティビティに合わせる（あとから変えることもできる）
                const picked = activities.find((a) => a.id === e.target.value)?.category;
                if (picked && picked in MENU_CATEGORY_LABELS) setCategory(picked as MenuFormValues['category']);
              }}
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
          <div className="space-y-1">
            <Label htmlFor="category">種類（一覧のアイコン・色）</Label>
            <select
              id="category"
              name="category"
              value={category}
              onChange={(e) => setCategory(e.target.value as MenuFormValues['category'])}
              aria-describedby="category-hint"
              className={cn(SELECT_CLASS, 'w-full')}
            >
              {Object.entries(MENU_CATEGORY_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <p id="category-hint" className="text-xs text-slate-600">
              プランの一覧に出すアイコンと色です。アクティビティを選ぶと、それに合わせて変わります。
            </p>
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
              inputMode="numeric"
              min={10}
              defaultValue={initial.durationMin}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="minAge">対象年齢（〜歳以上）</Label>
            <Input
              id="minAge"
              name="minAge"
              type="number"
              inputMode="numeric"
              min={0}
              defaultValue={initial.minAge ?? ''}
              placeholder="例：6（空欄なら制限なし）"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1 text-sm">
          {admin && (
            <label className="flex min-h-9 items-center gap-2 pointer-coarse:min-h-11">
              <input type="checkbox" name="featured" defaultChecked={initial.featured} className="size-4" />
              TOP の「おすすめ」に出す
            </label>
          )}
          <label className="flex min-h-9 items-center gap-2 pointer-coarse:min-h-11">
            <input type="checkbox" name="requireAges" defaultChecked={initial.requireAges} className="size-4" />
            申込で参加者全員の年齢を入力してもらう
          </label>
        </div>
        {admin && (
          <details className="rounded-lg border border-slate-200 p-3 text-sm" open={slugError || undefined}>
            <summary className="cursor-pointer py-1.5 font-medium text-slate-700 pointer-coarse:py-3">
              詳しい設定（ふだんは変えなくて大丈夫）
            </summary>
            <div className="mt-2 space-y-1">
              <Label htmlFor="slug">ページのアドレス（半角英小文字・数字・ハイフン。空欄なら自動）</Label>
              <Input
                id="slug"
                name="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                placeholder="例：ginowan-parasailing"
                aria-describedby="slug-preview"
              />
              <p id="slug-preview" className="text-xs break-all text-slate-600">
                お客様向けのページ：{publicUrlBase}
                {slug.trim() ||
                  (initial.slug ? `${initial.slug}（空欄にすると今のまま）` : '（保存すると自動で付きます）')}
              </p>
            </div>
          </details>
        )}
      </FormSection>

      <FormSection id="sec-capacity" title="人数と定員">
        <div className="grid gap-3 sm:grid-cols-3">
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
          <div className="space-y-1">
            <Label htmlFor="maxPartySize">
              1 予約の最大人数
              <RequiredMark />
            </Label>
            <Input
              id="maxPartySize"
              name="maxPartySize"
              type="number"
              inputMode="numeric"
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
        </div>
        <p className="text-xs text-slate-600">
          1 回あたりの定員は、保存したあとの{admin ? '「回の設定」' : '「開催時間・空き枠」'}で時刻ごとに決めます。
        </p>
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
      </FormSection>

      <FormSection
        id="sec-cutoff"
        title="予約の締切"
        description="Web での申込を、いつまで受け付けるかです。締切を過ぎた回は、サイトで申し込めなくなります。"
      >
        <fieldset className="space-y-2 text-sm">
          <legend className="sr-only">締切の決め方</legend>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-3 has-checked:border-sky-600 has-checked:bg-sky-50">
            <label className="flex min-h-9 items-center gap-2 pointer-coarse:min-h-11">
              <input
                type="radio"
                name="cutoffMode"
                value="minutes"
                checked={cutoffMode === 'minutes'}
                onChange={() => setCutoffMode('minutes')}
                className="size-4"
              />
              開始の
            </label>
            {cutoffMode === 'minutes' ? (
              <Input
                id="bookingCutoffMin"
                name="bookingCutoffMin"
                type="number"
                inputMode="numeric"
                min={0}
                value={cutoffMinutes}
                onChange={(e) => setCutoffMinutes(e.target.value)}
                required
                aria-label="Web 予約の締切（開始何分前）"
                className="w-24"
              />
            ) : (
              <>
                {/* 前日の締切のときも、開始何分前の値は今のまま送る（使わない） */}
                <input type="hidden" name="bookingCutoffMin" value={cutoffMinutes} />
                <span className="w-24 text-center text-slate-400 tabular-nums">{cutoffMinutes}</span>
              </>
            )}
            <span>分前まで</span>
            {cutoffMode === 'minutes' && (
              <span className="text-xs text-slate-600">（{minutesLabel(cutoffMinutes)}）</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-3 has-checked:border-sky-600 has-checked:bg-sky-50">
            <label className="flex min-h-9 items-center gap-2 pointer-coarse:min-h-11">
              <input
                type="radio"
                name="cutoffMode"
                value="prevDay"
                checked={cutoffMode === 'prevDay'}
                onChange={() => setCutoffMode('prevDay')}
                className="size-4"
              />
              参加日の前日の
            </label>
            {cutoffMode === 'prevDay' ? (
              <Input
                id="cutoffPrevDayTime"
                name="cutoffPrevDayTime"
                type="time"
                value={prevDayTime}
                onChange={(e) => setPrevDayTime(e.target.value)}
                required
                aria-label="前日の締切時刻"
                className="w-32"
              />
            ) : (
              <span className="w-32 text-center text-slate-400 tabular-nums">{prevDayTime}</span>
            )}
            <span>まで</span>
          </div>
        </fieldset>
      </FormSection>

      {admin && (
        <FormSection
          id="sec-operators"
          title="実施事業者"
          description="このプランを実施する事業者と、受入確認を依頼できる事業者です。"
        >
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
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">実施候補（受入確認を依頼できる事業者）</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {operators.map((o) => (
                <label
                  key={o.id}
                  className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm has-checked:border-sky-600 has-checked:bg-sky-50"
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
          </fieldset>
        </FormSection>
      )}

      <FormSection
        id="sec-description"
        title="説明（お客様向けページに表示）"
        description="持ち物・料金に含まれるものは、1 行に 1 つ書くと箇条書きで表示されます。"
      >
        <div className="space-y-1">
          <Label htmlFor="summary">一覧用の紹介文（短め）</Label>
          <Textarea
            id="summary"
            name="summary"
            rows={2}
            defaultValue={initial.summary}
            placeholder="例：専用ボートから宜野湾の大空へ。高さは 100m・150m・200m から選べます。"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="description">説明文</Label>
          <Textarea id="description" name="description" rows={6} defaultValue={initial.description} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="meetingPoint">集合場所（名称・集合時刻・注意文）</Label>
          <Textarea
            id="meetingPoint"
            name="meetingPoint"
            rows={3}
            defaultValue={initial.meetingPoint}
            placeholder="例：宜野湾マリーナ 受付前に、開始の 30 分前に集合"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="meetingAddress">集合場所の住所（地図を表示します）</Label>
            <Input
              id="meetingAddress"
              name="meetingAddress"
              defaultValue={initial.meetingAddress}
              placeholder="例：沖縄県宜野湾市真志喜4丁目4-1"
            />
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
          <Textarea
            id="whatToBring"
            name="whatToBring"
            rows={3}
            defaultValue={initial.whatToBring}
            placeholder={'例：\n水着（服の下に着てお越しください）\nタオル'}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="included">料金に含まれるもの（1 行に 1 つ）</Label>
          <Textarea
            id="included"
            name="included"
            rows={3}
            defaultValue={initial.included}
            placeholder={'例：\n体験料\n保険料'}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="conditions">参加条件</Label>
          <Textarea
            id="conditions"
            name="conditions"
            rows={3}
            defaultValue={initial.conditions}
            placeholder="例：4 歳以上（体重 15kg 以上の方）。妊娠中の方はご参加いただけません。"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="notes">注意事項</Label>
          <Textarea id="notes" name="notes" rows={4} defaultValue={initial.notes} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="weatherPolicy">天候等による中止（安全基準・中止のときの扱い）</Label>
          <Textarea
            id="weatherPolicy"
            name="weatherPolicy"
            rows={3}
            defaultValue={initial.weatherPolicy}
            placeholder="例：風速 8m 以上・波の高さ 1.5m 以上のときは中止します。"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cancellationPolicy">このプランのキャンセル規定</Label>
          <Textarea
            id="cancellationPolicy"
            name="cancellationPolicy"
            rows={3}
            defaultValue={initial.cancellationPolicy}
            placeholder="例：集合時刻に遅れた場合は、ご参加いただけないことがあります。"
          />
          <p className="text-xs text-slate-500">
            {admin
              ? 'キャンセル料の率と共通の規定は「設定」から自動で表示します。ここには率を書かず、このプランだけの決まり（遅刻のときの扱いなど）を書いてください。'
              : 'キャンセル料の率と共通の規定は組合が決め、自動で表示します。ここには率を書かず、このプランだけの決まり（遅刻のときの扱いなど）を書いてください。'}
          </p>
        </div>
      </FormSection>

      <FormSection id="sec-images" title="写真" description="1 枚目がメインの写真になります。">
        <div id="images" className="space-y-1">
          <PlanImagesField
            name="images"
            initial={initial.images}
            upload={uploadImage}
            allowUrl={admin}
            onChange={markDirty}
          />
        </div>
      </FormSection>

      <section id="prices" tabIndex={-1} className="scroll-mt-6 space-y-3 rounded-lg border bg-white p-4 outline-none">
        <h2 className="font-semibold">料金区分</h2>
        {/* 広い画面では見出しを 1 行だけ出す（スマホでは、行ごとに項目名を出す） */}
        <div
          aria-hidden
          className="hidden grid-cols-[minmax(0,1fr)_10rem_7rem_4.5rem] gap-2 text-sm font-medium text-slate-700 sm:grid"
        >
          <span>
            区分名
            <RequiredMark />
          </span>
          <span>
            料金（円・税込）
            <RequiredMark />
          </span>
          <span>季節</span>
          <span />
        </div>
        {prices.map((row, index) => (
          // スマホでは 1 行目に区分名、2 行目に料金・季節・削除を並べる
          <div
            key={row.key}
            className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-end gap-2 border-b border-slate-100 pb-3 last:border-0 sm:grid-cols-[minmax(0,1fr)_10rem_7rem_4.5rem] sm:border-0 sm:pb-0"
          >
            <div className="col-span-3 space-y-1 sm:col-span-1">
              <Label htmlFor={`price-label-${row.key}`} className="sm:sr-only">
                区分名
                <RequiredMark />
              </Label>
              <Input
                id={`price-label-${row.key}`}
                value={row.label}
                onChange={(e) => update(row.key, { label: e.target.value })}
                placeholder="例：大人"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`price-amount-${row.key}`} className="sm:sr-only">
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
            <div className="space-y-1">
              <Label htmlFor={`price-season-${row.key}`} className="sm:sr-only">
                季節
              </Label>
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
              className="text-red-700"
              disabled={prices.length <= 1}
              onClick={() => changePrices((rows) => rows.filter((r) => r.key !== row.key))}
              aria-label={`${index + 1} 行目の料金区分を削除`}
            >
              削除
            </Button>
            {!isPerPerson(unit) && (
              <div className="col-span-3 space-y-1 sm:col-span-4">
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
        <p className="text-xs text-slate-600">
          {seasonHint ??
            '季節を「繁忙期」「通常期」に分けると、事業者ごとに決めた繁忙期の期間の日は繁忙期の料金、それ以外の日は通常期の料金になります。'}
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            changePrices((rows) => [
              ...rows,
              { key: `row-${nextKey.current++}`, label: '', price: '', season: '', meetingPoint: '' },
            ])
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
