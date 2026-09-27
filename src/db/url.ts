/**
 * このアプリの DB 接続文字列。
 * DATABASE_URL は他プロジェクト用に OS の環境変数へ設定されていることがあり、.env.local より優先されてしまうため、
 * プロジェクト専用の MARINE_DATABASE_URL を優先する（Vercel の Neon 連携などで DATABASE_URL しかない場合のみフォールバック）。
 */
export function getDatabaseUrl(): string {
  const url = process.env.MARINE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('MARINE_DATABASE_URL is not set');
  return url;
}
