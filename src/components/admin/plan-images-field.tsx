'use client';

import Image from 'next/image';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { isRemoteImage } from '@/lib/image';

export type UploadImageResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * プランの写真の欄。アップロード・並べ替え・削除ができ、先頭がメインの写真になる。値は改行区切りの URL として
 * name の欄で送る（サーバーでは今までの「画像の URL」と同じに扱う）。allowUrl は組合だけ（取り込み済みの写真のパスなど）
 */
export function PlanImagesField({
  name,
  initial,
  upload,
  allowUrl = false,
  onChange,
}: {
  name: string;
  initial: string[];
  upload: (formData: FormData) => Promise<UploadImageResult>;
  allowUrl?: boolean;
  onChange?: () => void;
}) {
  const id = useId();
  const [urls, setUrls] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [urlInput, setUrlInput] = useState('');

  const change = (next: string[]) => {
    setUrls(next);
    onChange?.();
  };
  const move = (index: number, delta: number) => {
    const next = [...urls];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    change(next);
  };

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    const added: string[] = [];
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.set('file', file);
        const result = await upload(formData);
        if (result.ok) added.push(result.url);
        else setError(`${file.name}：${result.error}`);
      }
    } catch {
      setError('写真を送れませんでした。通信の状態を確かめて、もう一度選んでください。');
    } finally {
      setUploading(false);
    }
    if (added.length > 0) change([...urls, ...added]);
  }

  return (
    <div className="space-y-2">
      <textarea name={name} value={urls.join('\n')} readOnly hidden />
      {urls.length === 0 ? (
        <p className="text-sm text-slate-600">写真はまだありません。1 枚目がプランのメインの写真になります。</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {urls.map((url, index) => (
            <li key={`${url}-${index}`} className="space-y-1 rounded-lg border border-slate-200 p-2">
              <div className="relative aspect-[4/3] overflow-hidden rounded-md bg-slate-100">
                <Image
                  src={url}
                  alt={`写真 ${index + 1}`}
                  fill
                  sizes="200px"
                  unoptimized={isRemoteImage(url)}
                  className="object-cover"
                />
                {index === 0 && (
                  <span className="absolute top-1 left-1 rounded bg-slate-900/80 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                    メイン
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={`写真 ${index + 1} を前へ`}
                >
                  ←
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={index === urls.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={`写真 ${index + 1} を後ろへ`}
                >
                  →
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => change(urls.filter((_, i) => i !== index))}
                  aria-label={`写真 ${index + 1} を外す`}
                >
                  外す
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-1">
        {/* ブラウザの「ファイルを選択」ボタンは英語のままになることがあるので、日本語のボタンで開く */}
        <input
          id={`${id}-file`}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={uploading}
          onChange={(event) => {
            void onFiles(event.target.files);
            event.target.value = '';
          }}
          className="peer sr-only"
        />
        <label
          htmlFor={`${id}-file`}
          className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 hover:bg-slate-50 peer-focus-visible:ring-2 peer-focus-visible:ring-sky-500 peer-disabled:cursor-not-allowed peer-disabled:opacity-60"
        >
          写真を選んで追加
        </label>
        <p className="text-xs text-slate-600">JPEG・PNG・WebP、1 枚 10MB まで。何枚かまとめて選べます。</p>
        {uploading && (
          <p role="status" className="text-xs text-slate-600">
            写真を送っています…
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs font-semibold text-red-700">
            {error}
          </p>
        )}
      </div>
      {allowUrl && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <label htmlFor={`${id}-url`} className="block text-xs text-slate-600">
              URL で追加（/ で始まるパスか https:// の URL）
            </label>
            <Input id={`${id}-url`} value={urlInput} onChange={(e) => setUrlInput(e.target.value)} />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!urlInput.trim()}
            onClick={() => {
              change([...urls, urlInput.trim()]);
              setUrlInput('');
            }}
          >
            追加
          </Button>
        </div>
      )}
    </div>
  );
}
