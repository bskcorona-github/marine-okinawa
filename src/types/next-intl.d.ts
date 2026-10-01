import type messages from '@/messages/ja.json';

// メッセージのキーを型で確かめる（存在しないキーを t() に渡すとコンパイルエラーにする）
declare module 'next-intl' {
  interface AppConfig {
    Messages: typeof messages;
  }
}
