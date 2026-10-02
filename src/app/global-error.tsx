'use client';

/**
 * 画面の外枠（レイアウト）でエラーが起きたときの表示。外枠の代わりになるので html・body を持ち、
 * サイトのスタイルを読まずに表示できる最小の形にする。エラー番号はサーバーのログと同じ
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="ja">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f7f3ea', color: '#1b2a33' }}>
        <title>エラーが起きました</title>
        <main role="alert" style={{ maxWidth: 560, margin: '15vh auto', padding: '0 16px', lineHeight: 1.7 }}>
          <h1 style={{ fontSize: 22 }}>ページを表示できませんでした</h1>
          <p>少し待ってから、もう一度お試しください。続くときは、お手数ですが組合へお問い合わせください。</p>
          {error.digest && <p style={{ fontFamily: 'monospace', fontSize: 14 }}>エラー番号：{error.digest}</p>}
          <p style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => retry()}
              style={{
                minHeight: 44,
                padding: '0 20px',
                borderRadius: 10,
                border: 0,
                background: '#0a3a5c',
                color: '#fff',
              }}
            >
              もう一度試す
            </button>
            {/* 外枠ごと読み直すため、Link ではなく通常のリンクで移る */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/ja" style={{ alignSelf: 'center', color: '#0a3a5c' }}>
              トップページへ
            </a>
          </p>
        </main>
      </body>
    </html>
  );
}
