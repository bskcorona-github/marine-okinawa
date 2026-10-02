/** URL・メールアドレス・宣伝の文に使われやすい記号 */
const LINK_LIKE = /https?:|www\.|:\/\/|@|[<>{}[\]|\\]/i;
/** ドメインらしい書き方（example.com など） */
const DOMAIN_LIKE = /\.[a-z]{2,}(\/|$|\s)/i;

/**
 * 確かめていないメールアドレスへ送るメールの宛名。お客様が入れた氏名をそのまま出すと、URL・宣伝の文を組合の名前で
 * 第三者へ送る踏み台になるので、URL・メールアドレス・記号の多い名前・長すぎる名前は「お客様」にする
 */
export function recipientName(name: string): string {
  const trimmed = name.trim();
  const suspicious = LINK_LIKE.test(trimmed) || DOMAIN_LIKE.test(trimmed) || trimmed.length > 40;
  return suspicious || !trimmed ? 'お客様' : `${trimmed} 様`;
}
