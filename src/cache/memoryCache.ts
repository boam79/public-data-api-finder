/**
 * in-memory Map 기반 단순 TTL 캐시.
 * 동일/유사 질의에 대한 불필요한 외부 API 재호출을 방지한다.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class MemoryCache<T> {
  private store = new Map<string, CacheEntry<T>>();

  constructor(private ttlMs: number = 5 * 60 * 1000) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

/**
 * 질의 텍스트를 정규화해 캐시 키를 만든다.
 * 공백 정리 + 소문자 변환 + 정렬로 "축제 앱"과 "앱 축제"를 같은 키로 처리한다.
 */
export function normalizeCacheKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F\w\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join("_");
}
