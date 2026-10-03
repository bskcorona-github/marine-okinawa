'use client';

import { FileUp, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { MAX_FILE_BYTES as MAX_BYTES, MAX_FILE_MB } from '@/modules/storage/files';

const sizeLabel = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;

/**
 * ファイルの選択欄。ブラウザ標準のボタン（英語になることがある）の代わりに日本語のボタンを出し、
 * 選んだファイルの名前・大きさと「取り消す」を表示する。上限（MAX_FILE_MB）を超えるファイルは、送る前にその場で知らせる
 */
export function FileInput({
  name,
  label,
  required,
  multiple,
  accept = 'application/pdf,image/jpeg,image/png,image/webp',
  tone = 'admin',
  describedBy,
  invalid,
  onChange,
}: {
  name: string;
  label: string;
  required?: boolean;
  multiple?: boolean;
  accept?: string;
  /** admin：管理画面・事業者画面の見た目、site：公開サイトの見た目 */
  tone?: 'admin' | 'site';
  describedBy?: string;
  invalid?: boolean;
  /** 選んだファイルの合計（バイト）を知らせる（合計の上限を画面で確かめるため） */
  onChange?: (totalBytes: number) => void;
}) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const tooLarge = files.find((f) => f.size > MAX_BYTES);

  function update(list: File[]) {
    setFiles(list);
    const input = ref.current;
    if (input)
      input.setCustomValidity(
        list.some((f) => f.size > MAX_BYTES) ? `${MAX_FILE_MB}MB を超えるファイルは送れません` : '',
      );
    onChange?.(list.reduce((sum, f) => sum + f.size, 0));
  }

  function clear() {
    if (ref.current) ref.current.value = '';
    update([]);
  }

  return (
    <div className="space-y-1.5">
      <input
        ref={ref}
        id={id}
        name={name}
        type="file"
        accept={accept}
        multiple={multiple}
        required={required}
        aria-describedby={cn(describedBy, `${id}-status`) || undefined}
        aria-invalid={invalid || Boolean(tooLarge) || undefined}
        onChange={(event) => update([...(event.currentTarget.files ?? [])])}
        className="peer sr-only"
      />
      <label
        htmlFor={id}
        className={cn(
          'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-4 text-sm font-semibold peer-focus-visible:ring-3',
          tone === 'site'
            ? 'border-ocean/20 bg-foam text-ocean hover:bg-white peer-focus-visible:ring-lagoon/30'
            : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50 peer-focus-visible:ring-sky-300',
        )}
      >
        <FileUp aria-hidden className="size-4" />
        {files.length ? 'ファイルを選び直す' : 'ファイルを選ぶ'}
        <span className="sr-only">（{label}）</span>
      </label>
      <div id={`${id}-status`} aria-live="polite" className="text-xs">
        {files.length === 0 ? (
          <span className="text-slate-600">選んでいません</span>
        ) : (
          <ul className="space-y-1">
            {files.map((f) => (
              <li key={`${f.name}-${f.size}`} className={cn(f.size > MAX_BYTES ? 'text-red-700' : 'text-slate-700')}>
                {f.name}（{sizeLabel(f.size)}）{f.size > MAX_BYTES && ` … ${MAX_FILE_MB}MB を超えています`}
              </li>
            ))}
          </ul>
        )}
      </div>
      {files.length > 0 && (
        <button
          type="button"
          onClick={clear}
          className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-slate-700 underline-offset-2 hover:underline"
        >
          <X aria-hidden className="size-3.5" />
          選んだファイルを取り消す
        </button>
      )}
    </div>
  );
}
