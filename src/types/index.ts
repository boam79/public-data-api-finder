// ─── 외부 API 응답 원시 타입 ───────────────────────────────────────────────────

/** 공공데이터포털 uddiGetDatasetIndex 응답 단건 */
export interface RawSearchItem {
  /** 데이터셋 식별자 (UUID or id 문자열) */
  id?: string;
  /** 데이터셋 제목 */
  title?: string;
  /** 제공기관 */
  orgNm?: string;
  /** 서비스 유형: OpenAPI / 파일데이터 / 표준데이터셋 */
  serviceType?: string;
  /** 등록일 */
  registDt?: string;
  /** 수정일 */
  lastUpdtDt?: string;
  /** 설명 */
  description?: string;
  /** 상세 URL */
  detailUrl?: string;
  /** 업데이트 주기 */
  cycle?: string;
  /** 분류 */
  category?: string;
  /** API 유형 (REST/SOAP) */
  apiType?: string;
}

/** 목록조회 API 응답 전체 래퍼 */
export interface RawSearchResponse {
  currentCount?: number;
  matchCount?: number;
  page?: number;
  perPage?: number;
  totalCount?: number;
  data?: RawSearchItem[];
}

// ─── 정규화된 내부 타입 ────────────────────────────────────────────────────────

export type DatasetType = "API" | "FILE" | "UNKNOWN";

/** 내부에서 사용하는 정규화된 데이터셋 */
export interface NormalizedDataset {
  id: string;
  title: string;
  provider: string;
  type: DatasetType;
  description: string;
  updateCycle: string;
  detailUrl: string;
  /** 점수화에 활용될 raw 원본 보존 */
  _raw: RawSearchItem;
}

// ─── 추천 타입 ────────────────────────────────────────────────────────────────

export interface Recommendation {
  title: string;
  provider: string;
  type: DatasetType;
  updateCycle: string;
  reason: string;
  score: number;
  detailUrl: string;
}

// ─── MCP Tool 입출력 타입 ──────────────────────────────────────────────────────

export interface RecommendInput {
  ideaText: string;
  apiOnly?: boolean;
  realtimePreferred?: boolean;
  domainHint?: string;
  limit?: number;
}

export interface RecommendOutput {
  ideaSummary: string;
  extractedKeywords: string[];
  recommendations: Recommendation[];
}

export interface SearchInput {
  query: string;
  page?: number;
  limit?: number;
}

export interface SearchOutput {
  query: string;
  items: {
    title: string;
    summary?: string;
    provider?: string;
    detailUrl?: string;
  }[];
}

export interface RefineInput {
  previousResults: Recommendation[];
  apiOnly?: boolean;
  realtimePreferred?: boolean;
  providerIncludes?: string;
}

export interface RefineOutput {
  recommendations: Recommendation[];
}

/** 스코어링에 사용되는 context */
export interface ScoreContext {
  keywords: string[];
  apiOnly: boolean;
  realtimePreferred: boolean;
}
