'use client';

import {
  BarChart3,
  Building2,
  CalendarDays,
  ClipboardList,
  FileText,
  Home,
  Inbox,
  LayoutGrid,
  Menu,
  PhoneCall,
  Settings,
  Tags,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const NAV: { href: string; label: string; icon: LucideIcon; exact?: boolean }[] = [
  { href: '/admin', label: 'ダッシュボード', icon: Home, exact: true },
  { href: '/admin/bookings', label: '予約台帳', icon: ClipboardList },
  { href: '/admin/timetable', label: 'タイムテーブル', icon: CalendarDays },
  { href: '/admin/bookings/new', label: '手動予約', icon: PhoneCall },
  { href: '/admin/inquiries', label: 'お問い合わせ', icon: Inbox },
  { href: '/admin/reports', label: '日報・集計', icon: BarChart3 },
  { href: '/admin/menus', label: 'プラン', icon: LayoutGrid },
  { href: '/admin/activities', label: 'アクティビティ', icon: Tags },
  { href: '/admin/operators', label: '事業者', icon: Building2 },
  { href: '/admin/pages', label: '固定ページ', icon: FileText },
  { href: '/admin/settings', label: '設定', icon: Settings },
];

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  // 回の詳細はタイムテーブルから開く
  if (href === '/admin/timetable') return pathname.startsWith(href) || pathname.startsWith('/admin/slots');
  // /admin/bookings/new は「予約一覧」ではなく「手動予約」をアクティブにする
  if (href === '/admin/bookings') return pathname.startsWith(href) && !pathname.startsWith('/admin/bookings/new');
  return pathname.startsWith(href);
}

export function AdminNav() {
  const pathname = usePathname();
  // スマホでは、項目が多く横に並べると見えないため、「メニュー」ボタンで開く一覧にする（開いた先へ移ったら閉じる）
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === pathname;
  const current = NAV.find(({ href, exact }) => isActive(pathname, href, exact));
  const item = ({ href, label, icon: Icon, exact }: (typeof NAV)[number]) => {
    const active = isActive(pathname, href, exact);
    return (
      <li key={href}>
        <Link
          href={href}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-sm font-medium whitespace-nowrap transition lg:min-h-10',
            active ? 'bg-white/15 text-white' : 'text-white/75 hover:bg-white/10 hover:text-white',
          )}
        >
          <Icon aria-hidden className="size-4" />
          {label}
        </Link>
      </li>
    );
  };
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="admin-nav-list"
        onClick={() => setOpenFor(open ? null : pathname)}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg bg-white/10 px-3 text-sm font-semibold lg:hidden"
      >
        <span className="flex items-center gap-2">
          {open ? <X aria-hidden className="size-4" /> : <Menu aria-hidden className="size-4" />}
          メニュー
        </span>
        <span className="truncate text-white/80">{current?.label}</span>
      </button>
      <ul
        id="admin-nav-list"
        className={cn('mt-2 grid grid-cols-2 gap-1 lg:mt-0 lg:flex lg:flex-col', !open && 'hidden lg:flex')}
      >
        {NAV.map(item)}
      </ul>
    </>
  );
}
