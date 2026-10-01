/**
 * URL のパラメータなど外から来た文字列で、オブジェクトの値を引く。
 * 自分で定義したキーだけを見る（"toString" や "__proto__" で Object の組み込みの値を拾わないように）
 */
export function ownValue<T>(record: Record<string, T>, key: unknown): T | undefined {
  return typeof key === 'string' && Object.hasOwn(record, key) ? record[key] : undefined;
}

/** key が record の自分のキーか（型も絞る） */
export function isOwnKey<K extends string>(record: Record<K, unknown>, key: unknown): key is K {
  return typeof key === 'string' && Object.hasOwn(record, key);
}
