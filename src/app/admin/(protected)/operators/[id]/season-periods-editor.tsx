'use client';

import { CopyPlus, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { SELECT_CLASS } from '@/components/admin/field-styles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Row = { key: string; start: string; end: string };

let seq = 0;
const newKey = () => `period-${++seq}`;
const DAY_MS = 86_400_000;

/** 2027-02-29 のような日は 2 月末にそろえて、1 年後の日付にする */
function nextYear(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
  return `${y + 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

/** 364 日後（同じ曜日）の日付。土日だけのオン期などを、翌年の同じ曜日に合わせるときに使う */
function sameWeekdayNextYear(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 364 * DAY_MS).toISOString().slice(0, 10);
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const weekday = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];

function days(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS) + 1;
}

/**
 * オン期の期間を 1 行ずつ入力する。送信時は「開始〜終了」を 1 行 1 期間にした文字列（name="periods"）で渡す。
 * 終了日が空なら開始日の 1 日だけとみなす
 */
export function SeasonPeriodsEditor({
  initial,
  onChange,
}: {
  initial: { startDate: string; endDate: string }[];
  onChange: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    initial.map((p) => ({ key: newKey(), start: p.startDate, end: p.endDate })),
  );
  const change = (next: (rows: Row[]) => Row[]) => {
    setRows(next);
    onChange();
  };
  const filled = rows.filter((r) => r.start);
  const invalid = filled.filter((r) => r.end && r.end < r.start);
  const sorted = [...filled].filter((r) => !invalid.includes(r)).sort((a, b) => a.start.localeCompare(b.start));
  const overlaps = sorted.some((r, i) => i > 0 && r.start <= (sorted[i - 1].end || sorted[i - 1].start));
  const totalDays = sorted.reduce((sum, r) => sum + days(r.start, r.end || r.start), 0);
  // 画面の行の順に 1 行ずつ渡す（空の行は空行のまま。サーバーのエラーの「n 行目」が画面の n 件目と一致する）
  const serialized = rows
    .map((r) => (!r.start ? '' : r.end && r.end !== r.start ? `${r.start}〜${r.end}` : r.start))
    .join('\n');
  // コピー元の年：初期値は期間の数がいちばん多い年（同じ数なら新しい年）。年の変わり目の数日だけの年は選ばない
  const years = [...new Set(sorted.map((r) => r.start.slice(0, 4)))];
  const countOf = (year: string) => sorted.filter((r) => r.start.startsWith(year)).length;
  const busiest = years.reduce<string | null>((best, y) => (best && countOf(best) > countOf(y) ? best : y), null);
  const [copyFrom, setCopyFrom] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState('');
  const sourceYear = copyFrom && years.includes(copyFrom) ? copyFrom : busiest;

  function copyToNextYear(shift: (date: string) => string) {
    const existing = new Set(rows.map((r) => `${r.start}|${r.end}`));
    const added = sorted
      .filter((r) => r.start.slice(0, 4) === sourceYear)
      .map((r) => ({ key: newKey(), start: shift(r.start), end: r.end ? shift(r.end) : '' }))
      .filter((r) => !existing.has(`${r.start}|${r.end}`));
    if (added.length > 0) change((current) => [...current, ...added]);
    setCopyMessage(
      added.length > 0
        ? `${added.length} 件の期間を追加しました（保存するまで反映されません）。`
        : 'コピーする期間はありませんでした（同じ期間がすでに登録されています）。',
    );
  }

  return (
    <fieldset className="space-y-3">
      <legend className="font-medium">オン期の期間</legend>
      <p className="text-xs text-slate-500">
        料金区分で「オン期」「オフ期」を分けたプランは、この期間の日はオン期料金、それ以外の日はオフ期料金になります。
      </p>
      <input type="hidden" name="periods" value={serialized} />
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500">
          期間が登録されていません（すべての日がオフ期料金になります）。
        </p>
      ) : (
        <ul className="space-y-2" id="periods">
          {rows.map((row, index) => {
            const bad = row.start && row.end && row.end < row.start;
            return (
              <li key={row.key} className="flex flex-wrap items-center gap-2">
                <Input
                  type="date"
                  aria-label={`${index + 1} 件目の開始日`}
                  value={row.start}
                  onChange={(e) =>
                    change((rs) => rs.map((r) => (r.key === row.key ? { ...r, start: e.target.value } : r)))
                  }
                  className="w-40"
                />
                <span aria-hidden>〜</span>
                <Input
                  type="date"
                  aria-label={`${index + 1} 件目の終了日（1 日だけなら空欄）`}
                  value={row.end}
                  min={row.start || undefined}
                  aria-invalid={Boolean(bad)}
                  onChange={(e) =>
                    change((rs) => rs.map((r) => (r.key === row.key ? { ...r, end: e.target.value } : r)))
                  }
                  className="w-40"
                />
                <span className="w-24 text-xs text-slate-500 tabular-nums">
                  {row.start && !bad
                    ? `${weekday(row.start)}${row.end && row.end !== row.start ? `〜${weekday(row.end)}` : ''} ・ ${days(row.start, row.end || row.start)} 日`
                    : ''}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`${index + 1} 件目の期間を削除`}
                  onClick={() => change((rs) => rs.filter((r) => r.key !== row.key))}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => change((rs) => [...rs, { key: newKey(), start: '', end: '' }])}
        >
          <Plus aria-hidden />
          期間を追加
        </Button>
        {sourceYear && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2">
            <label className="flex items-center gap-1.5">
              <select
                value={sourceYear}
                onChange={(e) => setCopyFrom(e.target.value)}
                aria-label="コピー元の年"
                className={SELECT_CLASS}
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y} 年
                  </option>
                ))}
              </select>
              の期間を {Number(sourceYear) + 1} 年に
            </label>
            <Button type="button" variant="outline" onClick={() => copyToNextYear(nextYear)}>
              <CopyPlus aria-hidden />
              同じ日付でコピー
            </Button>
            <Button type="button" variant="outline" onClick={() => copyToNextYear(sameWeekdayNextYear)}>
              <CopyPlus aria-hidden />
              同じ曜日でコピー（364 日後）
            </Button>
          </div>
        )}
      </div>
      <div aria-live="polite" className="space-y-1 text-sm">
        {copyMessage && <p className="font-medium text-sky-900">{copyMessage}</p>}
        {sorted.length > 0 && (
          <p className="text-slate-600">
            {sorted.length} 期間・合計 {totalDays} 日（{sorted[0].start} 〜 {sorted.at(-1)!.end || sorted.at(-1)!.start}
            ）
          </p>
        )}
        {invalid.length > 0 && <p className="font-medium text-red-700">終了日が開始日より前の期間があります。</p>}
        {overlaps && (
          <p className="font-medium text-amber-800">期間が重なっています（重なった日はオン期として扱います）。</p>
        )}
      </div>
    </fieldset>
  );
}
