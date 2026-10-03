import { MessageSquareReply } from 'lucide-react';
import { REQUEST_STATUS_TONE } from '@/components/backoffice/request-status-tone';
import { cn } from '@/lib/utils';
import { REQUEST_STATUS_LABELS } from '@/modules/partner/requests';

/**
 * 「事業者の回答あり（組合の対応待ち）」の札。ダッシュボード・予約台帳・予約の詳細で同じ見た目・言い方にする
 * （受入可・条件付き・受入不可を色と文字の両方で伝える）
 */
export function OperatorResponseBadge({
  response,
  className,
}: {
  response: 'accepted' | 'conditional' | 'declined' | null;
  className?: string;
}) {
  const status = response ?? 'accepted';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
        REQUEST_STATUS_TONE[status],
        className,
      )}
    >
      <MessageSquareReply aria-hidden className="size-3" />
      事業者の回答：{REQUEST_STATUS_LABELS[status]}
    </span>
  );
}
