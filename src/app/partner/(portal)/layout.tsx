import { Waves } from 'lucide-react';
import Link from 'next/link';
import { SignOutButton } from '@/components/backoffice/sign-out-button';
import { PartnerNav } from '@/components/partner/partner-nav';
import { db } from '@/db';
import { requireOperator } from '@/modules/auth/guard';
import { countAwaitingReport, getPortalHeader } from '@/modules/partner/bookings';
import { countPendingRequests } from '@/modules/partner/requests';
import { telHref } from '@/modules/shop/contact';

/** 事業者画面の枠。ページ・Server Action でも毎回 requireOperator で確かめる（この枠だけに頼らない） */
export default async function PartnerPortalLayout({ children }: LayoutProps<'/partner'>) {
  const operator = await requireOperator();
  const now = new Date();
  const [row, pending, awaitingReport] = await Promise.all([
    getPortalHeader(db, operator.operatorId),
    countPendingRequests(db, operator.operatorId),
    countAwaitingReport(db, { operatorId: operator.operatorId, now }),
  ]);
  const contact = row?.profile;
  return (
    <div className="min-h-screen lg:flex">
      <aside className="on-dark z-30 flex shrink-0 flex-col gap-3 bg-[#053a40] px-3 py-3 text-white lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:px-4 lg:py-5">
        <div className="flex items-center justify-between gap-3 lg:mb-4">
          <Link href="/partner" className="flex min-w-0 items-center gap-2" title={row?.name}>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
              <Waves aria-hidden className="size-4" />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-bold lg:whitespace-normal">{row?.name ?? '事業者'}</span>
              <span className="block truncate text-[11px] text-white/75">事業者画面 ・ {row?.shopName}</span>
            </span>
          </Link>
          <div className="shrink-0 lg:hidden">
            <SignOutButton />
          </div>
        </div>
        <nav aria-label="事業者メニュー" className="relative">
          <PartnerNav pendingRequests={pending} awaitingReport={awaitingReport} />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-[#053a40] to-transparent lg:hidden"
          />
        </nav>
        {/* メールアドレス・パスワードの変更・ログアウトは縦に並べる（横に詰めると 1 つのリンクに見えるため） */}
        <div className="mt-auto hidden flex-col items-start gap-2 border-t border-white/10 pt-4 text-xs text-white/75 lg:flex">
          <p className="max-w-full truncate" title={operator.email}>
            {operator.email}
          </p>
          <Link href="/partner/password" className="inline-flex min-h-9 items-center underline pointer-coarse:min-h-11">
            パスワードを変更
          </Link>
          <SignOutButton />
        </div>
      </aside>
      <main className="min-w-0 flex-1 bg-slate-50 px-4 py-6 md:px-8">
        {children}
        {/* 回答を直したい・困ったときに、組合へすぐ連絡できるように */}
        {(contact?.phone || contact?.email) && (
          <footer className="mt-10 max-w-4xl rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">組合への連絡（{row?.shopName}）</p>
            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {contact.phone && (
                <a href={telHref(contact.phone)} className="font-semibold text-sky-800 tabular-nums hover:underline">
                  電話 {contact.phone}
                </a>
              )}
              {contact.businessHours && <span>受付 {contact.businessHours}</span>}
              {contact.email && (
                <a href={`mailto:${contact.email}`} className="break-all text-sky-800 hover:underline">
                  {contact.email}
                </a>
              )}
            </p>
          </footer>
        )}
      </main>
    </div>
  );
}
