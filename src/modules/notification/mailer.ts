import { render } from '@react-email/components';
import type { ReactElement } from 'react';
import { Resend } from 'resend';
import { getEnv } from '@/lib/env';
import { logError } from '@/lib/log';

export type MailMessage = {
  to: string;
  subject: string;
  react: ReactElement;
  /** 返信先（ショップの問い合わせ用メールアドレス）。送信元は送信専用のアドレスのため */
  replyTo?: string;
  /** 同じメールを二重に送らないためのキー（送信サービスに渡す） */
  idempotencyKey?: string;
};

/** 送信サービスの応答を待ちきれなかった（送れたかどうか分からない） */
export class MailTimeoutError extends Error {
  constructor(ms: number) {
    super(`mail send timed out after ${ms}ms`);
    this.name = 'MailTimeoutError';
  }
}

export interface Mailer {
  send(message: MailMessage): Promise<{ id: string }>;
}

/** メール送信の待ち時間の上限（送信中に予約の行をロックしている処理があるため、長く待たない） */
const SEND_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new MailTimeoutError(ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function createResendMailer(apiKey: string, from: string): Mailer {
  const resend = new Resend(apiKey);
  return {
    async send(message) {
      // Resend の `react:` は実行時に @react-email/render を読む。Vercel のバンドルではそれが無く、
      // 「Make sure to install @react-email/render」で落ちるので、こちらで HTML にしてから送る
      const html = await render(message.react);
      const { data, error } = await withTimeout(
        resend.emails.send(
          {
            from,
            to: message.to,
            subject: message.subject,
            html,
            ...(message.replyTo ? { replyTo: message.replyTo } : {}),
          },
          message.idempotencyKey ? { idempotencyKey: message.idempotencyKey } : undefined,
        ),
        SEND_TIMEOUT_MS,
      );
      if (error || !data) throw new Error(`resend: ${error?.message ?? 'no response data'}`);
      return { id: data.id };
    },
  };
}

/** 開発・テスト用：送信せずにコンソールへ出す（宛先は伏せる。件名で確かめる） */
function createLogMailer(): Mailer {
  return {
    async send(message) {
      const to = message.to.replace(/^[^@]*/, (local) => `${local.slice(0, 1)}***`);
      console.info(`[mail] to=${to} subject=${message.subject}`);
      return { id: `log-${Date.now()}` };
    },
  };
}

/**
 * 送信の設定がないとき：送るたびに失敗にする（送信の記録は failed になり、画面に「送れなかった」と出る）。
 * 準備の段階で例外を投げると、申込などの操作の画面までエラーになるため
 */
function createUnconfiguredMailer(reason: string): Mailer {
  return {
    async send() {
      throw new Error(reason);
    },
  };
}

export function getMailer(): Mailer {
  const env = getEnv();
  if (env.MAIL_DRIVER === 'resend') {
    if (!env.RESEND_API_KEY) {
      logError('mail.config.missing_key', { status: env.MAIL_DRIVER });
      return createUnconfiguredMailer('RESEND_API_KEY is not set');
    }
    return createResendMailer(env.RESEND_API_KEY, env.MAIL_FROM);
  }
  // 本番で送信の設定がないと、お客様へのメールが黙って捨てられる。送るたびに失敗にして、画面と記録に出す
  if (process.env.VERCEL_ENV === 'production') {
    logError('mail.config.not_resend', { status: env.MAIL_DRIVER });
    return createUnconfiguredMailer('MAIL_DRIVER must be "resend" in production');
  }
  return createLogMailer();
}
