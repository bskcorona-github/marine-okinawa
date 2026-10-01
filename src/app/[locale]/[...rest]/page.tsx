import { notFound } from 'next/navigation';

/** 存在しない URL もサイト共通の枠（ヘッダー・フッター）付きの 404 を表示する */
export default function CatchAllPage() {
  notFound();
}
