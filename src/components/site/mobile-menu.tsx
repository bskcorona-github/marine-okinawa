'use client';

import { Menu, X } from 'lucide-react';
import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { Link, usePathname } from '@/i18n/navigation';

const NAV_ID = 'site-mobile-nav';

type Props = {
  items: { href: string; label: string }[];
  navLabel: string;
  openLabel: string;
  closeLabel: string;
};

/**
 * スマホのメニュー。リンクを押したとき・ページやハッシュが変わったとき・Esc・メニューの外を押したときに閉じる。
 * Esc で閉じたときはメニューボタンにフォーカスを戻す
 */
export function MobileMenu({ items, navLabel, openLabel, closeLabel }: Props) {
  const pathname = usePathname();
  // 開いたときのページを覚えておき、別のページへ移ったら閉じた扱いにする（effect の中で state を戻さずに済む）
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpenAt(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      close();
      buttonRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('hashchange', close);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('hashchange', close);
    };
  }, [open]);

  // Tab でメニューの外へ移ったら閉じる（外側のクリックは pointerdown で扱うので、移動先がないときは何もしない）
  function onBlur(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget as Node | null;
    if (open && next && !event.currentTarget.contains(next)) setOpenAt(null);
  }

  return (
    <div ref={rootRef} className="relative lg:hidden" onBlur={onBlur}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={NAV_ID}
        aria-label={open ? closeLabel : openLabel}
        onClick={() => setOpenAt(open ? null : pathname)}
        className="flex size-11 items-center justify-center rounded-xl text-ocean hover:bg-foam"
      >
        {open ? <X aria-hidden className="size-6" /> : <Menu aria-hidden className="size-6" />}
      </button>
      <nav
        id={NAV_ID}
        aria-label={navLabel}
        hidden={!open}
        className="absolute top-12 right-0 w-56 rounded-2xl border border-ocean/10 bg-white p-2 shadow-xl"
      >
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpenAt(null)}
            className="block rounded-xl px-4 py-3 text-sm font-medium text-ink hover:bg-foam"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
