import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * ブラウザで JS が動き始めたら true。JS で送信するフォームは、それまで送信ボタンを押せないようにする
 * （読み込み前に押されると、ブラウザの既定の送信で入力内容が URL に載ってしまうため）
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
