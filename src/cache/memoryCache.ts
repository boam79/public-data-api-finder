/**
 * in-memory Map 기반 TTL 캐시.
 *
 * - 일반 쿼리: 5분 TTL
 * - 실시간 키워드 포함 쿼리: 1분 TTL (최신 데이터 중요)
 * - 데이터셋 상세 정보: 30분 TTL (변경 빈도 낮음)
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class MemoryCache<T> {
  private store = new Map<string, CacheEntry<T>>();

  constructor(private defaultTtlMs: number = 5 * 60 * 1000) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** ttlMs를 지정하면 해당 항목에만 개별 TTL 적용 */
  set(key: string, value: T, ttlMs?: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
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

// ─── TTL 프리셋 ────────────────────────────────────────────────────────────────

export const TTL = {
  REALTIME: 1 * 60 * 1000,      // 1분 — 실시간 키워드 쿼리
  DEFAULT: 5 * 60 * 1000,       // 5분 — 일반 추천/검색
  DETAIL: 30 * 60 * 1000,       // 30분 — 데이터셋 상세 정보
} as const;

// ─── 실시간 키워드 감지 ────────────────────────────────────────────────────────

const REALTIME_TERMS = [
  "실시간", "현재", "지금", "날씨", "교통", "버스", "지하철",
  "공기", "미세먼지", "대기", "주가", "환율",
];

export function isRealtimeQuery(text: string): boolean {
  const lower = text.toLowerCase();
  return REALTIME_TERMS.some((t) => lower.includes(t));
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
