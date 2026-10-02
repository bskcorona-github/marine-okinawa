import { randomBytes } from 'node:crypto';

/**
 * サーバーのログ（Vercel のランタイムログ）。1 行の JSON で出し、障害の調べやすさと個人情報の守りを両立する。
 * - fields には id・コード・件数・金額だけを入れる（氏名・メール・電話・トークン・口座は入れない。型で絞る）
 * - エラーは describeError で、DB のパラメータ（入力の値）や本文を出さない形にする
 * イベント名は「領域.処理.結果」（例：mail.send.failed、stripe.refund.sent、cron.sync_slots.done）
 */
export type LogFields = Partial<
  Record<
    | 'bookingId'
    | 'paymentId'
    | 'notificationId'
    | 'requestId'
    | 'menuId'
    | 'operatorId'
    | 'settlementId'
    | 'checkoutId'
    | 'paymentIntentId'
    | 'refundId'
    | 'documentId'
    | 'inquiryId'
    | 'applicationId'
    | 'eventId'
    | 'userId'
    | 'shopId'
    | 'period'
    | 'code'
    | 'kind'
    | 'status'
    | 'route',
    string | null
  >
> & { count?: number; amount?: number; durationMs?: number };

type Level = 'info' | 'warn' | 'error';

/** メールアドレス・電話番号らしい文字列を伏せる（エラーの文に入力の値が混ざったとき） */
function mask(text: string): string {
  return text
    .replace(/[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/g, '[email]')
    .replace(/\+?\d[\d\s-]{8,}\d/g, '[number]')
    .slice(0, 500);
}

/** エラーをログに出してよい形にする（DB のパラメータ・本文は出さない） */
export function describeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { value: mask(String(error)) };
  const out: Record<string, unknown> = { name: error.name };
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') out.code = code;
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number') out.status = status;
  // Drizzle の DrizzleQueryError は message に SQL とパラメータ（入力の値）を含むので、SQL だけを出す
  const query = (error as { query?: unknown }).query;
  if (typeof query === 'string') {
    out.query = query.slice(0, 300);
  } else {
    out.message = mask(error.message);
  }
  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === 'object') {
    const c = cause as { code?: unknown; constraint?: unknown; table?: unknown; message?: unknown };
    out.cause = {
      code: typeof c.code === 'string' ? c.code : undefined,
      constraint: typeof c.constraint === 'string' ? c.constraint : undefined,
      table: typeof c.table === 'string' ? c.table : undefined,
      message: typeof c.message === 'string' && typeof query !== 'string' ? mask(c.message) : undefined,
    };
  }
  if (error.stack)
    out.stack = error.stack
      .split('\n')
      .slice(1, 6)
      .map((l) => l.trim());
  return out;
}

function write(level: Level, event: string, fields: LogFields = {}, error?: unknown, ref?: string) {
  const line = JSON.stringify({
    level,
    event,
    ...(ref ? { ref } : {}),
    ...fields,
    ...(error === undefined ? {} : { error: describeError(error) }),
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

export function logInfo(event: string, fields?: LogFields): void {
  write('info', event, fields);
}

export function logWarn(event: string, fields?: LogFields, error?: unknown): void {
  write('warn', event, fields, error);
}

/** エラーのログ。返す ref（8 文字）を画面に出すと、問い合わせのときにログと突き合わせられる */
export function logError(event: string, fields: LogFields, error?: unknown): string {
  const ref = randomBytes(4).toString('hex');
  write('error', event, fields, error, ref);
  return ref;
}
