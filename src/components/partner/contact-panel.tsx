import { Mail, Phone } from 'lucide-react';
import { Panel } from '@/components/backoffice/page-header';
import { formatPhoneForDisplay } from '@/modules/customer/normalize';
import { telHref } from '@/modules/shop/contact';

/** 事業者画面の代表者（氏名・電話・メール）。取消などで値が空なら出さない */
export function PartnerContactPanel({
  name,
  phone,
  email,
}: {
  name: string | null;
  phone: string | null;
  email: string | null;
}) {
  if (!name && !phone && !email) return null;
  const displayPhone = phone ? formatPhoneForDisplay(phone) : null;
  return (
    <Panel title="代表者">
      {name && <p className="text-base font-semibold text-slate-900">{name} 様</p>}
      <div className={name ? 'mt-3 space-y-2' : 'space-y-2'}>
        {displayPhone && phone && (
          <a
            href={telHref(phone)}
            className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 font-semibold text-sky-800 tabular-nums hover:bg-sky-50"
          >
            <Phone aria-hidden className="size-4" />
            {displayPhone}
          </a>
        )}
        {email && (
          <a
            href={`mailto:${email}`}
            className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm break-all text-sky-800 hover:bg-sky-50"
          >
            <Mail aria-hidden className="size-4 shrink-0" />
            {email}
          </a>
        )}
      </div>
    </Panel>
  );
}
