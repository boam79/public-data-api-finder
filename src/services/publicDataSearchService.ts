/**
 * 공공데이터포털 목록조회서비스 래퍼
 * API: https://apis.data.go.kr/openapi/data/uddiGetDatasetIndex
 */

import type { RawSearchItem, RawSearchResponse } from "../types/index.js";
import { logger } from "../utils/logger.js";

const BASE_URL = "https://apis.data.go.kr/openapi/data/uddiGetDatasetIndex";

export interface SearchOptions {
  keyword: string;
  numOfRows?: number;
  pageNo?: number;
  /** "uddi:openapi.go.kr:mois-mois-000049-0" 형태의 카테고리 (선택) */
  cond?: string;
}

/** fetch 주입을 통해 테스트 시 목(mock) 교체 가능 */
export type FetchFn = typeof fetch;

export async function searchPublicDatasets(
  options: SearchOptions,
  serviceKey: string,
  fetchFn: FetchFn = fetch
): Promise<RawSearchItem[]> {
  const { keyword, numOfRows = 20, pageNo = 1 } = options;

  const params = new URLSearchParams({
    serviceKey,
    keyword,
    numOfRows: String(numOfRows),
    pageNo: String(pageNo),
    returnType: "json",
  });

  const url = `${BASE_URL}?${params.toString()}`;
  logger.info("searchPublicDatasets 호출", { keyword, numOfRows, pageNo });

  let res: Response;
  try {
    res = await fetchFn(url);
  } catch (err) {
    logger.error("네트워크 오류", err);
    throw new Error(`공공데이터 검색 네트워크 오류: ${String(err)}`);
  }

  if (!res.ok) {
    logger.error("검색 API 오류 응답", { status: res.status });
    throw new Error(`공공데이터 검색 API 오류: HTTP ${res.status}`);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error("검색 API 응답이 유효한 JSON이 아닙니다");
  }

  return parseSearchResponse(body);
}

function parseSearchResponse(body: unknown): RawSearchItem[] {
  if (!body || typeof body !== "object") return [];

  // 응답 구조: { currentCount, matchCount, totalCount, data: [...] }
  const resp = body as Record<string, unknown>;

  if (Array.isArray(resp["data"])) {
    return (resp["data"] as RawSearchItem[]).filter(Boolean);
  }

  // 대안 구조: { response: { body: { items: { item: [...] } } } }
  const response = resp["response"] as Record<string, unknown> | undefined;
  if (response) {
    const bodyPart = response["body"] as Record<string, unknown> | undefined;
    if (bodyPart) {
      const items = bodyPart["items"] as Record<string, unknown> | undefined;
      if (items) {
        const item = items["item"];
        if (Array.isArray(item)) return item as RawSearchItem[];
        if (item && typeof item === "object") return [item as RawSearchItem];
      }
    }
  }

  logger.warn("파싱 불가한 검색 응답 구조", resp);
  return [];
}

export function getServiceKey(): string {
  const key = process.env["PUBLIC_DATA_SERVICE_KEY"];
  if (!key) {
    throw new Error(
      "PUBLIC_DATA_SERVICE_KEY 환경변수가 설정되지 않았습니다. .env 파일을 확인하세요."
    );
  }
  return key;
}
