/**
 * 공공데이터활용지원센터_공공데이터포털 검색 서비스 (ID: 15112888)
 *
 * 공식 Swagger: https://infuser.odcloud.kr/api/stages/43698/api-docs
 *
 * 엔드포인트: POST https://api.odcloud.kr/api/GetSearchDataList/v1/searchData
 * 인증: serviceKey 쿼리 파라미터
 *
 * 요청 body (JSON):
 *   keyword     : string          - 검색어
 *   page        : number (기본 1)
 *   size        : number (기본 10, 최대 10000)
 *   dataType    : string[]        - "FILE" | "API" | "STD"
 *   sort        : string          - "_sort"(정확도) | "inqireCo"(조회) | "reqCo"(활용) | "updtDt"(수정일)
 *   sortOrder   : string          - "desc" | "asc"
 *
 * 응답: { statusCode: 200, result: { sum: N, dataCount: N, data: [...] } }
 */

import type { RawSearchItem } from "../types/index.js";
import { logger } from "../utils/logger.js";
import { fetchWithRetry } from "../utils/retry.js";

const SEARCH_URL =
  "https://api.odcloud.kr/api/GetSearchDataList/v1/searchData";

export interface SearchOptions {
  keyword: string;
  size?: number;
  page?: number;
  /** 기본값: ["FILE","API","STD"] — 전체 타입 검색. 점수화 단계에서 API형 우대 */
  dataType?: string[];
  /** 1차 분류체계 (예: "문화관광", "교통물류", "공공행정") */
  brm?: string;
  /** 제공기관 이름 (정확한 명칭) */
  organizations?: string[];
  /** 수정일 이상 필터 (YYYY-MM-DD) */
  gte?: string;
  /** 수정일 이하 필터 (YYYY-MM-DD) */
  lte?: string;
  /** 정렬 기준: "_score"(정확도) | "reqCo"(활용순) | "inqireCo"(조회순) | "updtDt"(수정일) */
  sort?: "_score" | "reqCo" | "inqireCo" | "updtDt";
  /** 정렬 방향: "desc" | "asc" */
  sortOrder?: "desc" | "asc";
}

export type FetchFn = typeof fetch;

/** 검색 서비스 응답 단건 → RawSearchItem 매핑 */
function mapItem(item: Record<string, unknown>): RawSearchItem {
  const rawType = String(item["dataType"] ?? "");
  const provisionType = String(item["dataProvisionType"] ?? "");
  const isApi = rawType === "API";

  const rawTags = item["keywords"];
  const tags = Array.isArray(rawTags)
    ? (rawTags as unknown[]).map(String)
    : [];

  return {
    id: String(item["dataId"] ?? ""),
    title: String(item["dataName"] ?? ""),
    orgNm: String(item["organization"] ?? ""),
    serviceType: isApi ? "OpenAPI" : rawType,
    apiType: provisionType,
    description: String(item["dataDescription"] ?? ""),
    lastUpdtDt: String(item["updateDate"] ?? ""),
    registDt: String(item["updateDate"] ?? ""),
    cycle: "",
    category: String(item["firstBrmName"] ?? ""),
    detailUrl: String(item["detailPageUrl"] ?? ""),
    tags,
    coreData: item["coreData"] === true,
    corpApi: item["corpApi"] === true,
  };
}

/** 응답 body에서 items 배열 추출 */
function extractItems(body: unknown): RawSearchItem[] {
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;

  // { statusCode: 200, result: { sum, dataCount, data: [...] } }
  const result = b["result"];
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (Array.isArray(r["data"])) {
      return (r["data"] as Record<string, unknown>[]).map(mapItem);
    }
  }
  return [];
}

/**
 * API가 HTTP 500을 반환하는 특수문자·기호를 제거.
 * K-Startup, R&D, "나라장터 입찰" 같은 복합 쿼리에서 500 방지.
 */
function sanitizeKeyword(raw: string): string {
  return raw
    .replace(/[&<>'"\\|`]/g, " ") // API 오류 유발 특수문자 제거
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * 공공데이터포털 검색 서비스로 키워드 검색
 *
 * serviceKey는 URL 쿼리 파라미터로 전달 (Authorization 헤더 방식은 미지원)
 */
export async function searchPublicDatasets(
  options: SearchOptions,
  serviceKey: string,
  fetchFn: FetchFn = fetch
): Promise<RawSearchItem[]> {
  const {
    keyword: rawKeyword,
    size = 20,
    page = 1,
    dataType = ["FILE", "API", "STD"],
    brm,
    organizations,
    gte,
    lte,
    sort = "_score",
    sortOrder = "desc",
  } = options;

  // HTTP 500 유발 특수문자 정제 (K-Startup → K Startup, R&D → R D)
  const keyword = sanitizeKeyword(rawKeyword);

  // serviceKey는 data.go.kr에서 발급된 인코딩 키 그대로 사용 (추가 인코딩 불필요)
  const url = `${SEARCH_URL}?serviceKey=${serviceKey}`;

  const bodyPayload: Record<string, unknown> = {
    keyword,
    page,
    size,
    dataType,
    sort,
    sortOrder,
  };
  if (brm) bodyPayload["brm"] = [brm];
  if (organizations?.length) bodyPayload["organizations"] = organizations;
  if (gte) bodyPayload["gte"] = gte;
  if (lte) bodyPayload["lte"] = lte;

  logger.info("searchPublicDatasets 호출", { keyword, size, page });

  let res: Response;
  try {
    res = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(bodyPayload),
      },
      { maxAttempts: 3, baseDelayMs: 500, timeoutMs: 8000, fetchFn }
    );
  } catch (err) {
    logger.error("네트워크 오류", err);
    throw new Error(`공공데이터 검색 네트워크 오류: ${String(err)}`);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    if (!res.ok) {
      throw new Error(`공공데이터 검색 API 오류: HTTP ${res.status}`);
    }
    throw new Error("검색 API 응답이 유효한 JSON이 아닙니다");
  }

  // API 레벨 오류 (code < 0)
  if (
    body &&
    typeof body === "object" &&
    "code" in (body as object) &&
    Number((body as Record<string, unknown>)["code"]) < 0
  ) {
    const msg = String(
      (body as Record<string, unknown>)["msg"] ?? "알 수 없는 오류"
    );
    logger.error("API 오류 응답", {
      code: (body as Record<string, unknown>)["code"],
      msg,
    });

    if (msg.includes("등록되지 않은") || msg.includes("미신청")) {
      throw new Error(
        `공공데이터 API 미신청: data.go.kr에서 공공데이터포털 검색 서비스(ID:15112888) 활용 신청 후 이용하세요.`
      );
    }
    throw new Error(`공공데이터 API 오류: ${msg}`);
  }

  if (!res.ok) {
    logger.error("검색 API 오류 응답", { status: res.status });
    throw new Error(`공공데이터 검색 API 오류: HTTP ${res.status}`);
  }

  return extractItems(body);
}

export function getServiceKey(): string {
  const key = process.env["PUBLIC_DATA_SERVICE_KEY"];
  if (!key) {
    throw new Error(
      "PUBLIC_DATA_SERVICE_KEY 환경변수가 설정되지 않았습니다."
    );
  }
  return key;
}
