'use client';

import {
  Banknote,
  BarChart3,
  Building2,
  CalendarDays,
  ClipboardList,
  FileText,
  History,
  Home,
  Inbox,
  LayoutGrid,
  type LucideIcon,
  Menu,
  PhoneCall,
  Settings,
  Tags,
  ToggleRight,
  TrendingUp,
  X,
} from 'lucide-react';
import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type NavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean };

/** 毎日使うものを上に、ときどき使う設定を下に、見出しで分ける */
const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: '毎日の業務',
    items: [
      { href: '/admin', label: 'ダッシュボード', icon: Home, exact: true },
      { href: '/admin/bookings', label: '予約台帳', icon: ClipboardList },
      { href: '/admin/timetable', label: 'タイムテーブル', icon: CalendarDays },
      { href: '/admin/bookings/new', label: '手動予約', icon: PhoneCall },
      { href: '/admin/inquiries', label: 'お問い合わせ', icon: Inbox },
    ],
  },
  {
    title: 'お金・数字',
    items: [
      { href: '/admin/reports', label: '日報・集計', icon: BarChart3 },
      { href: '/admin/analytics', label: '分析', icon: TrendingUp },
      { href: '/admin/settlements', label: '精算', icon: Banknote },
    ],
  },
  {
    title: '管理',
    items: [
      { href: '/admin/menus', label: 'プラン', icon: LayoutGrid },
      { href: '/admin/activities', label: 'アクティビティ', icon: Tags },
      { href: '/admin/operators', label: '事業者', icon: Building2 },
      { href: '/admin/pages', label: '固定ページ', icon: FileText },
      { href: '/admin/logs', label: '操作の記録', icon: History },
      { href: '/admin/settings', label: '設定', icon: Settings },
      { href: '/admin/features', label: '機能の切り替え', icon: ToggleRight },
    ],
  },
];

const NAV = NAV_GROUPS.flatMap((g) => g.items);

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  // 回の詳細はタイムテーブルから開く
  if (href === '/admin/timetable') return pathname.startsWith(href) || pathname.startsWith('/admin/slots');
  // /admin/bookings/new は「予約一覧」ではなく「手動予約」をアクティブにする
  if (href === '/admin/bookings') return pathname.startsWith(href) && !pathname.startsWith('/admin/bookings/new');
  return pathname.startsWith(href);
}

/** 押した項目の右に、次の画面を読み込んでいるあいだだけ回る印を出す（大きさは固定して、表示がずれないようにする） */
function PendingMark() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={cn(
        'size-3.5 shrink-0 rounded-full border-2 border-white/30 border-t-white transition-opacity',
        pending ? 'animate-spin opacity-100' : 'opacity-0',
      )}
    />
  );
}

export function AdminNav({
  counts,
  countLabels,
  account,
}: {
  /** 対応が必要な件数（項目の href ごと） */
  counts: Partial<Record<string, number>>;
  countLabels: Record<string, string>;
  /** スマホでメニューを開いたときに一番下に出す、アカウントの欄（パソコンでは左の列の下に別に出す） */
  account: ReactNode;
}) {
  const pathname = usePathname();
  // スマホでは、項目が多く横に並べると見えないため、「メニュー」ボタンで開く一覧にする（開いた先へ移ったら閉じる）
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === pathname;
  const current = NAV.find(({ href, exact }) => isActive(pathname, href, exact));
  const totalCount = Object.values(counts).reduce<number>((sum, n) => sum + (n ?? 0), 0);
  const item = ({ href, label, icon: Icon, exact }: NavItem) => {
    const active = isActive(pathname, href, exact);
    const n = counts[href] ?? 0;
    return (
      <li key={href}>
        <Link
          href={href}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-sm font-medium whitespace-nowrap transition lg:min-h-8 pointer-coarse:lg:min-h-11',
            active ? 'bg-white/15 text-white' : 'text-white/75 hover:bg-white/10 hover:text-white',
          )}
        >
          <Icon aria-hidden className="size-4 shrink-0" />
          <span className="min-w-0 truncate">{label}</span>
          <span className="ml-auto flex items-center gap-1.5">
            {n > 0 && (
              <span className="rounded-full bg-amber-300 px-1.5 text-xs leading-5 font-bold text-slate-900 tabular-nums">
                {n}
                <span className="sr-only">件の{countLabels[href] ?? '対応待ち'}</span>
              </span>
            )}
            <PendingMark />
          </span>
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
          {!open && totalCount > 0 && (
            <span className="rounded-full bg-amber-300 px-1.5 text-xs leading-5 font-bold text-slate-900 tabular-nums">
              {totalCount}
              <span className="sr-only">件の対応待ち</span>
            </span>
          )}
        </span>
        <span className="truncate text-white/80">{current?.label}</span>
      </button>
      <div id="admin-nav-list" className={cn('mt-2 space-y-3 lg:mt-0 lg:space-y-2', !open && 'hidden lg:block')}>
        {NAV_GROUPS.map((group, i) => (
          <div key={group.title}>
            {/* 見出しの順（h1 → h2）を崩さないよう、見出しの要素にはせず、一覧の名前にする */}
            <p id={`admin-nav-group-${i}`} className="px-3 pb-1 text-[11px] font-semibold tracking-wide text-white/55">
              {group.title}
            </p>
            <ul aria-labelledby={`admin-nav-group-${i}`} className="grid grid-cols-2 gap-1 lg:flex lg:flex-col">
              {group.items.map(item)}
            </ul>
          </div>
        ))}
        <div className="border-t border-white/10 pt-3 lg:hidden">{account}</div>
      </div>
    </>
  );
}
