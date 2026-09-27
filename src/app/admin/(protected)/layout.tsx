import Link from 'next/link';
import { requireAdmin } from '@/modules/auth/guard';
import { SignOutButton } from './sign-out-button';

const NAV = [
  { href: '/admin', label: 'タイムテーブル' },
  { href: '/admin/bookings', label: '予約一覧' },
  { href: '/admin/bookings/new', label: '手動予約' },
  { href: '/admin/menus', label: 'メニュー' },
  { href: '/admin/operators', label: '事業者' },
  { href: '/admin/settings', label: '設定' },
];

export default async function ProtectedAdminLayout({ children }: LayoutProps<'/admin'>) {
  const admin = await requireAdmin();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <nav className="flex shrink-0 flex-row gap-1 overflow-x-auto border-b bg-slate-900 p-2 text-sm text-white md:w-48 md:flex-col md:border-b-0 md:p-4">
        <p className="mb-4 hidden font-bold md:block">予約管理</p>
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} className="rounded px-3 py-2 whitespace-nowrap hover:bg-slate-700">
            {item.label}
          </Link>
        ))}
        <div className="mt-auto hidden pt-4 text-xs text-slate-400 md:block">{admin.email}</div>
        <SignOutButton />
      </nav>
      <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
