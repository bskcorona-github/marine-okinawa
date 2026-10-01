'use client';

import { useEffect, useRef } from 'react';

/**
 * 置いた <form> の select・チェックボックスが変わったら、その場で送信する（絞り込みの「表示」ボタンを省く）。
 * 日付の入力欄は、入力途中で送信されないよう対象外にする。
 */
export function SubmitOnChange() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    const onChange = (event: Event) => {
      const target = event.target as HTMLInputElement | HTMLSelectElement;
      if (target.tagName === 'SELECT' || (target instanceof HTMLInputElement && target.type === 'checkbox')) {
        form.requestSubmit();
      }
    };
    form.addEventListener('change', onChange);
    return () => form.removeEventListener('change', onChange);
  }, []);
  return <span ref={ref} hidden />;
}
