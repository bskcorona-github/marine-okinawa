'use client';

import { startTransition, useActionState, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MENU_CATEGORY_LABELS, MENU_STATUS_LABELS } from '@/modules/booking/labels';
import type { MenuFormState } from './actions';

export type MenuFormValues = {
  slug: string;
  status: keyof typeof MENU_STATUS_LABELS;
  category: keyof typeof MENU_CATEGORY_LABELS;
  durationMin: number;
  minAge: number | null;
  maxPartySize: number;
  bookingCutoffMin: number;
  cutoffPrevDayTime: string | null;
  operatorId: string | null;
  capacityUnit: '名' | '艇';
  title: string;
  description: string;
  meetingPoint: string;
  whatToBring: string;
  summary: string;
  included: string;
  conditions: string;
  notes: string;
  images: string[];
  prices: { id?: string; label: string; price: number; season: string | null }[];
};

type Props = {
  action: (prev: MenuFormState, formData: FormData) => Promise<MenuFormState>;
  initial: MenuFormValues;
  operators: { id: string; name: string }[];
  submitLabel: string;
};

type PriceRow = { key: string; id?: string; label: string; price: string; season: string };

let rowSeq = 0;
const newKey = () => `row-${++rowSeq}`;

export function MenuForm({ action, initial, operators, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [prices, setPrices] = useState<PriceRow[]>(() =>
    initial.prices.map((p) => ({
      key: newKey(),
      id: p.id,
      label: p.label,
      price: String(p.price),
      season: p.season ?? '',
    })),
  );

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  const update = (key: string, patch: Partial<PriceRow>) =>
    setPrices((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-6">
      <input
        type="hidden"
        name="prices"
        value={JSON.stringify(
          prices.map(({ id, label, price, season }) => ({ id, label, price, season: season || null })),
        )}
      />
      <section className="space-y-3 rounded-lg border bg-white p-4">
        <h2 className="font-semibold">基本情報</h2>
        <div className="space-y-1">
          <Label htmlFor="title">メニュー名</Label>
          <Input id="title" name="title" defaultValue={initial.title} required />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="slug">URL 名（半角英小文字・数字・ハイフン）</Label>
            <Input id="slug" name="slug" defaultValue={initial.slug} required pattern="[a-z0-9]+(-[a-z0-9]+)*" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="status">公開状態</Label>
            <select id="status" name="status" defaultValue={initial.status} className="h-8 w-full rounded border px-2">
              {Object.entries(MENU_STATUS_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="category">カテゴリ</Label>
            <select
              id="category"
              name="category"
              defaultValue={initial.category}
              className="h-8 w-full rounded border px-2"
            >
              {Object.entries(MENU_CATEGORY_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="durationMin">所要時間（分）</Label>
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
            <Label htmlFor="maxPartySize">1 予約の最大人数</Label>
            <Input
              id="maxPartySize"
              name="maxPartySize"
              type="number"
              min={1}
              defaultValue={initial.maxPartySize}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="bookingCutoffMin">Web 予約の締切（開始何分前）</Label>
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
          <div className="space-y-1">
            <Label htmlFor="operatorId">提供事業者</Label>
            <select
              id="operatorId"
              name="operatorId"
              defaultValue={initial.operatorId ?? ''}
              className="h-8 w-full rounded border px-2"
            >
              <option value="">（なし）</option>
              {operators.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="capacityUnit">定員の単位</Label>
            <select
              id="capacityUnit"
              name="capacityUnit"
              defaultValue={initial.capacityUnit}
              className="h-8 w-full rounded border px-2"
            >
              <option value="名">名（人数）</option>
              <option value="艇">艇（貸切）</option>
            </select>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          前日の締切時刻を入れると「参加日の前日のその時刻まで」になり、開始何分前の設定より優先されます。
        </p>
      </section>

      <section className="space-y-3 rounded-lg border bg-white p-4">
        <h2 className="font-semibold">説明（お客様向けページに表示）</h2>
        <div className="space-y-1">
          <Label htmlFor="summary">一覧用の紹介文（短め）</Label>
          <Textarea id="summary" name="summary" rows={2} defaultValue={initial.summary} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="description">説明文</Label>
          <Textarea id="description" name="description" rows={6} defaultValue={initial.description} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="meetingPoint">集合場所</Label>
          <Textarea id="meetingPoint" name="meetingPoint" rows={2} defaultValue={initial.meetingPoint} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="whatToBring">持ち物</Label>
          <Textarea id="whatToBring" name="whatToBring" rows={2} defaultValue={initial.whatToBring} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="included">料金に含まれるもの</Label>
          <Textarea id="included" name="included" rows={2} defaultValue={initial.included} />
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
          <Label htmlFor="images">画像の URL（1 行に 1 つ。先頭がメイン画像）</Label>
          <Textarea
            id="images"
            name="images"
            rows={4}
            defaultValue={initial.images.join('\n')}
            className="font-mono text-xs"
          />
        </div>
      </section>

      <section className="space-y-3 rounded-lg border bg-white p-4">
        <h2 className="font-semibold">料金区分</h2>
        {prices.map((row, index) => (
          <div key={row.key} className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor={`price-label-${row.key}`}>区分名</Label>
              <Input
                id={`price-label-${row.key}`}
                value={row.label}
                onChange={(e) => update(row.key, { label: e.target.value })}
                required
              />
            </div>
            <div className="w-32 space-y-1">
              <Label htmlFor={`price-amount-${row.key}`}>料金（円・税込）</Label>
              <Input
                id={`price-amount-${row.key}`}
                type="number"
                min={0}
                value={row.price}
                onChange={(e) => update(row.key, { price: e.target.value })}
                required
              />
            </div>
            <div className="w-28 space-y-1">
              <Label htmlFor={`price-season-${row.key}`}>季節</Label>
              <select
                id={`price-season-${row.key}`}
                value={row.season}
                onChange={(e) => update(row.key, { season: e.target.value })}
                className="h-8 w-full rounded border px-2"
              >
                <option value="">通年</option>
                <option value="on">オン期</option>
                <option value="off">オフ期</option>
              </select>
            </div>
            <Button
              type="button"
              variant="ghost"
              disabled={prices.length <= 1}
              onClick={() => setPrices((rows) => rows.filter((r) => r.key !== row.key))}
              aria-label={`${index + 1} 行目の料金区分を削除`}
            >
              削除
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() => setPrices((rows) => [...rows, { key: newKey(), label: '', price: '0', season: '' }])}
        >
          料金区分を追加
        </Button>
      </section>

      {state.error && (
        <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}
