/**
 * 공공데이터포털 목록조회서비스 (api.odcloud.kr)
 *
 * 공식 Swagger: https://infuser.odcloud.kr/oas/docs?namespace=15077093/v1
 *
 * 엔드포인트:
 *   - standard-data-list : 전체 데이터 + 키워드 검색 지원
 *   - open-data-list     : OpenAPI형만 (키워드 필터 없음)
 *   - file-data-list     : 파일형만   (키워드 필터 없음)
 *
 * 인증: Authorization: Infuser {serviceKey} 헤더
 */

import type { RawSearchItem } from "../types/index.js";
import { logger } from "../utils/logger.js";

const BASE = "https://api.odcloud.kr/api/15077093/v1";

export interface SearchOptions {
  keyword: string;
  perPage?: number;
  page?: number;
}

export type FetchFn = typeof fetch;

/** odcloud 응답 단건 → RawSearchItem 매핑 */
function mapItem(item: Record<string, unknown>): RawSearchItem {
  const dataType = String(item["data_type"] ?? item["serviceType"] ?? "");
  const isApi =
    dataType.includes("오픈API") ||
    dataType.includes("OpenAPI") ||
    dataType.includes("open") ||
    String(item["list_type"] ?? "").includes("오픈API");

  return {
    id: String(item["id"] ?? item["list_id"] ?? ""),
    title: String(item["title"] ?? item["list_title"] ?? ""),
    orgNm: String(item["org_nm"] ?? ""),
    serviceType: isApi ? "OpenAPI" : dataType,
    description: String(item["desc"] ?? item["description"] ?? ""),
    lastUpdtDt: String(item["updated_at"] ?? ""),
    registDt: String(item["created_at"] ?? ""),
    cycle: String(item["update_cycle"] ?? ""),
    category: String(item["new_category_nm"] ?? ""),
  };
}

/** 응답 body에서 items 배열 추출 */
function extractItems(body: unknown): RawSearchItem[] {
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;

  // odcloud 정상 응답: { data: [...], page, perPage, totalCount, currentCount }
  if (Array.isArray(b["data"])) {
    return (b["data"] as Record<string, unknown>[]).map(mapItem);
  }
  return [];
}

/**
 * standard-data-list로 키워드 검색
 * cond[title::LIKE] + cond[keywords::LIKE] 복합 사용
 */
export async function searchPublicDatasets(
  options: SearchOptions,
  serviceKey: string,
  fetchFn: FetchFn = fetch
): Promise<RawSearchItem[]> {
  const { keyword, perPage = 20, page = 1 } = options;

  // URLSearchParams가 [ ] : 를 퍼센트 인코딩하므로 직접 쿼리스트링을 구성한다
  const encodedKeyword = encodeURIComponent(keyword);
  const url =
    `${BASE}/standard-data-list` +
    `?page=${page}` +
    `&perPage=${perPage}` +
    `&returnType=json` +
    `&cond[title::LIKE]=${encodedKeyword}`;
  const headers: Record<string, string> = {
    Authorization: `Infuser ${serviceKey}`,
    Accept: "application/json",
  };

  logger.info("searchPublicDatasets 호출", { keyword, perPage, page });

  let res: Response;
  try {
    res = await fetchFn(url, { headers });
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

  // API 레벨 오류 체크 (HTTP 4xx/5xx 포함 — odcloud는 400/401로도 JSON 오류를 반환)
  if (
    body &&
    typeof body === "object" &&
    "code" in (body as object) &&
    Number((body as Record<string, unknown>)["code"]) < 0
  ) {
    const msg = String((body as Record<string, unknown>)["msg"] ?? "알 수 없는 오류");
    logger.error("API 오류 응답", { code: (body as Record<string, unknown>)["code"], msg });

    if (msg.includes("등록되지 않은") || msg.includes("미신청")) {
      throw new Error(
        `공공데이터 API 미신청: data.go.kr에서 목록조회서비스(ID:15077093) 활용 신청 후 이용하세요.`
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

/**
 * open-data-list로 API형 데이터 전체 목록 조회 (최신순)
 * 키워드 필터 없음 — keyword 매칭은 이후 스코어링에서 처리
 */
export async function fetchOpenApiList(
  serviceKey: string,
  perPage = 20,
  page = 1,
  fetchFn: FetchFn = fetch
): Promise<RawSearchItem[]> {
  const params = new URLSearchParams({
    page: String(page),
    perPage: String(perPage),
    returnType: "json",
  });

  const url = `${BASE}/open-data-list?${params.toString()}`;
  const headers: Record<string, string> = {
    Authorization: `Infuser ${serviceKey}`,
    Accept: "application/json",
  };

  logger.info("fetchOpenApiList 호출", { perPage, page });

  let res: Response;
  try {
    res = await fetchFn(url, { headers });
  } catch (err) {
    throw new Error(`공공데이터 목록 네트워크 오류: ${String(err)}`);
  }

  if (!res.ok) throw new Error(`공공데이터 목록 API 오류: HTTP ${res.status}`);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error("목록 API 응답이 유효한 JSON이 아닙니다");
  }

  if (
    body &&
    typeof body === "object" &&
    "code" in (body as object) &&
    Number((body as Record<string, unknown>)["code"]) < 0
  ) {
    const msg = String((body as Record<string, unknown>)["msg"] ?? "알 수 없는 오류");
    throw new Error(`공공데이터 API 오류: ${msg}`);
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
