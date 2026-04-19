/**
 * get_dataset_detail — 데이터셋 상세 메타데이터 조회 도구.
 *
 * data.go.kr은 SPA(JavaScript 렌더링) 구조이므로 Swagger 스펙을 서버사이드에서
 * 직접 파싱할 수 없다. 대신 공개된 Schema.org 카탈로그 엔드포인트를 사용한다.
 *
 * URL 패턴별 카탈로그 엔드포인트:
 *   openapi.do  → /catalog/{id}/openapi.json  (API 형)
 *   fileData.do → /catalog/{id}/fileData.json (파일 형)
 *   standard.do → /catalog/{id}/standard.json (표준 형)
 */

import type { DatasetDetailOutput } from "../types/index.js";
import { MemoryCache, TTL } from "../cache/memoryCache.js";
import { logger } from "../utils/logger.js";
import { fetchWithRetry } from "../utils/retry.js";

const detailCache = new MemoryCache<DatasetDetailOutput>(TTL.DETAIL);

const PORTAL_BASE = "https://www.data.go.kr";

/** detailUrl에서 publicDataPk 및 타입 suffix 추출 */
function parseDetailUrl(url: string): { pk: string; suffix: string } | null {
  const m = url.match(/\/data\/(\d+)\/(openapi|fileData|standard)\.do/);
  if (!m) return null;
  return { pk: m[1], suffix: m[2] };
}

/** suffix → catalog 파일명 매핑 */
function catalogFilename(suffix: string): string {
  const map: Record<string, string> = {
    openapi: "openapi.json",
    fileData: "fileData.json",
    standard: "standard.json",
  };
  return map[suffix] ?? "openapi.json";
}

/** Schema.org 카탈로그 JSON → DatasetDetailOutput 변환 */
function catalogToOutput(
  catalog: Record<string, unknown>,
  detailUrl: string,
  pk: string,
  suffix: string
): DatasetDetailOutput {
  const creator = (catalog["creator"] as Record<string, unknown>) ?? {};
  const contact = (creator["contactPoint"] as Record<string, unknown>) ?? {};

  const provider = [
    String(creator["name"] ?? ""),
    String(contact["contactType"] ?? ""),
    String(contact["telephone"] ?? ""),
  ]
    .filter(Boolean)
    .join(" / ");

  const keywords = String(catalog["keywords"] ?? "")
    .split(/[,，]/)
    .map((k) => k.trim())
    .filter(Boolean);

  const encodingFormat = String(catalog["encodingFormat"] ?? "");
  const datasetTimeInterval = String(catalog["datasetTimeInterval"] ?? "");
  const license = String(catalog["license"] ?? "");
  const dateModified = String(catalog["dateModified"] ?? "");
  const description = String(catalog["description"] ?? "");

  const oasViewerUrl = `${PORTAL_BASE}/data/${pk}/${suffix}.do`;

  const noteLines = [
    description ? `설명: ${description.slice(0, 200)}${description.length > 200 ? "..." : ""}` : "",
    encodingFormat ? `응답 형식: ${encodingFormat}` : "",
    datasetTimeInterval ? `업데이트 주기: ${datasetTimeInterval}` : "",
    license ? `라이선스: ${license}` : "",
    dateModified ? `최근 수정일: ${dateModified}` : "",
    keywords.length > 0 ? `태그: ${keywords.join(", ")}` : "",
    `API 명세 확인: ${oasViewerUrl} (브라우저 접속 후 Swagger UI 탭)`,
  ].filter(Boolean);

  return {
    title: String(catalog["name"] ?? ""),
    provider,
    baseUrl: "",
    endpoints: [],
    authMethod:
      "공공데이터포털 인증키(serviceKey) — 활용 신청 후 data.go.kr 마이페이지에서 발급",
    swaggerUrl: oasViewerUrl,
    detailPageUrl: detailUrl,
    note: noteLines.join("\n"),
  };
}

/** 단일 카탈로그 URL 시도 — 실패 또는 데이터 없음이면 null 반환 */
async function fetchCatalog(
  catalogUrl: string
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetchWithRetry(
      catalogUrl,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "application/json, */*",
          Referer: PORTAL_BASE + "/",
        },
      },
      { maxAttempts: 2, timeoutMs: 8000 }
    );

    if (!res.ok) return null;

    // 본문이 JSON인지 확인 후 파싱
    const text = await res.text();
    if (!text.trim().startsWith("{")) return null;

    const json = JSON.parse(text) as Record<string, unknown>;

    // "해당 데이터는 존재하지 않습니다." 같은 에러 응답 걸러내기
    const nameStr = String(json["name"] ?? "").trim();
    const descStr = String(json["description"] ?? "");
    if (!nameStr && descStr.includes("존재하지 않")) return null;

    return json;
  } catch {
    return null;
  }
}

export async function getDatasetDetail(
  detailUrl: string
): Promise<DatasetDetailOutput> {
  const cacheKey = detailUrl.trim();
  const cached = detailCache.get(cacheKey);
  if (cached) {
    logger.info("상세 캐시 히트", { detailUrl });
    return cached;
  }

  logger.info("데이터셋 상세 조회", { detailUrl });

  // 1. URL에서 publicDataPk + suffix 추출
  const parsed = parseDetailUrl(detailUrl);
  if (!parsed) {
    return buildNotFound(detailUrl, "URL 형식이 올바르지 않습니다.");
  }
  const { pk, suffix } = parsed;

  // 2. 올바른 suffix로 카탈로그 먼저 시도, 실패 시 나머지 순서로 fallback
  const suffixOrder = [
    suffix,
    ...["openapi", "fileData", "standard"].filter((s) => s !== suffix),
  ];

  let catalog: Record<string, unknown> | null = null;
  let usedSuffix = suffix;

  for (const s of suffixOrder) {
    const catalogUrl = `${PORTAL_BASE}/catalog/${pk}/${catalogFilename(s)}`;
    logger.info("카탈로그 조회 시도", { catalogUrl });
    catalog = await fetchCatalog(catalogUrl);
    if (catalog) {
      usedSuffix = s;
      break;
    }
  }

  if (!catalog) {
    return buildNotFound(
      detailUrl,
      "공공데이터포털에서 해당 데이터셋의 메타데이터를 가져올 수 없습니다."
    );
  }

  const result = catalogToOutput(catalog, detailUrl, pk, usedSuffix);
  detailCache.set(cacheKey, result, TTL.DETAIL);
  return result;
}

function buildNotFound(detailUrl: string, reason: string): DatasetDetailOutput {
  const parsed = parseDetailUrl(detailUrl);
  const oasViewerUrl = parsed
    ? `${PORTAL_BASE}/data/${parsed.pk}/${parsed.suffix}.do`
    : detailUrl;

  return {
    title: "상세 정보 조회 불가",
    provider: "",
    baseUrl: "",
    endpoints: [],
    authMethod: "공공데이터포털 인증키(serviceKey)",
    swaggerUrl: oasViewerUrl,
    detailPageUrl: detailUrl,
    note: [
      `사유: ${reason}`,
      `직접 확인: ${oasViewerUrl}`,
      "브라우저에서 위 URL을 열면 Swagger UI로 API 명세를 확인할 수 있습니다.",
    ].join("\n"),
  };
}
