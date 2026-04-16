// ─── 외부 API 응답 원시 타입 ───────────────────────────────────────────────────

/** 공공데이터포털 검색 서비스(15112888) 응답 단건 */
export interface RawSearchItem {
  /** 데이터셋 식별자 */
  id?: string;
  /** 데이터셋 제목 */
  title?: string;
  /** 제공기관 */
  orgNm?: string;
  /** 서비스 유형: OpenAPI / 파일데이터 / 표준데이터셋 */
  serviceType?: string;
  /** 등록일 */
  registDt?: string;
  /** 수정일 (YYYY-MM-DD) */
  lastUpdtDt?: string;
  /** 설명 */
  description?: string;
  /** 상세 URL */
  detailUrl?: string;
  /** 업데이트 주기 */
  cycle?: string;
  /** 1차 분류체계 */
  category?: string;
  /** API 제공 유형 (REST/SOAP/LINK) */
  apiType?: string;
  /** 키워드 태그 배열 */
  tags?: string[];
  /** 국가중점데이터 여부 */
  coreData?: boolean;
  /** 기업전용 API 여부 */
  corpApi?: boolean;
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
  /** 수정일 (YYYY-MM-DD, 점수화 최신성 계산용) */
  lastUpdated: string;
  detailUrl: string;
  /** 포털이 부여한 키워드 태그 */
  tags: string[];
  /** 국가중점데이터 여부 */
  coreData: boolean;
  /** 기업전용 API 여부 */
  corpApi: boolean;
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
  /** 일부 키워드 검색 실패 시 경고 메시지 */
  warning?: string;
}

export interface SearchInput {
  query: string;
  page?: number;
  limit?: number;
  /** 데이터 타입 필터 (기본: ["API"]) */
  dataType?: string[];
  /** 1차 분류체계 필터 (예: "문화관광", "교통물류") */
  brm?: string;
  /** 수정일 이후 필터 (YYYY-MM-DD) */
  updatedAfter?: string;
}

export interface DatasetDetailInput {
  /** data.go.kr 데이터셋 상세 URL 또는 데이터 ID */
  detailUrl: string;
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
  /** 기업전용 API 제외 여부 (기본: true) */
  excludeCorpApi?: boolean;
}

export interface ApiParameter {
  name: string;
  in: "query" | "body" | "path" | "header";
  required: boolean;
  type: string;
  description: string;
}

export interface DatasetDetailOutput {
  title: string;
  provider: string;
  baseUrl: string;
  endpoints: {
    method: string;
    path: string;
    summary: string;
    parameters: ApiParameter[];
  }[];
  authMethod: string;
  swaggerUrl: string;
  detailPageUrl: string;
}
