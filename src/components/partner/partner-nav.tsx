'use client';

import {
  Building2,
  ClipboardList,
  FileText,
  Home,
  LayoutList,
  MessageSquareReply,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

const NAV: { href: string; label: string; icon: LucideIcon; exact?: boolean }[] = [
  { href: '/partner', label: 'ホーム', icon: Home, exact: true },
  { href: '/partner/requests', label: '受入確認', icon: MessageSquareReply },
  { href: '/partner/bookings', label: '予約・催行報告', icon: ClipboardList },
  { href: '/partner/plans', label: 'プラン', icon: LayoutList },
  { href: '/partner/profile', label: '登録情報', icon: Building2 },
  { href: '/partner/documents', label: '資料', icon: FileText },
];

/** 事業者画面のメニュー（スマホでは横にスクロール、PC では縦に並べる） */
export function PartnerNav({ pendingRequests, awaitingReport }: { pendingRequests: number; awaitingReport: number }) {
  const pathname = usePathname();
  const listRef = useRef<HTMLUListElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);
  // スマホ（横にスクロールするメニュー）では、今のページの項目が見えるよう、メニューだけを横に動かす
  // （ページの縦の位置は変えない。#report などで開いたときに上へ戻さないため）
  useEffect(() => {
    const list = listRef.current;
    const item = activeRef.current;
    if (!list || !item || list.scrollWidth <= list.clientWidth) return;
    list.scrollLeft = item.offsetLeft - (list.clientWidth - item.offsetWidth) / 2;
  }, [pathname]);
  return (
    <ul ref={listRef} className="relative flex gap-1 overflow-x-auto pr-8 lg:flex-col lg:overflow-visible lg:pr-0">
      {NAV.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <li key={href} className="shrink-0">
            <Link
              ref={active ? activeRef : undefined}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm font-medium whitespace-nowrap transition',
                active ? 'bg-white/15 text-white' : 'text-white/75 hover:bg-white/10 hover:text-white',
              )}
            >
              <Icon aria-hidden className="size-4" />
              {label}
              {href === '/partner/requests' && pendingRequests > 0 && (
                <span className="rounded-full bg-orange-800 px-1.5 text-xs font-bold text-white">
                  {pendingRequests}
                  <span className="sr-only"> 件の回答待ち</span>
                </span>
              )}
              {href === '/partner/bookings' && awaitingReport > 0 && (
                <span className="rounded-full bg-orange-800 px-1.5 text-xs font-bold text-white">
                  {awaitingReport}
                  <span className="sr-only"> 件の催行報告待ち</span>
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
