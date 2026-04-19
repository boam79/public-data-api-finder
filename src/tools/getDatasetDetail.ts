/**
 * get_dataset_detail — 데이터셋 상세 메타데이터 조회 도구.
 *
 * data.go.kr은 SPA(JavaScript 렌더링) 구조이므로 Swagger 스펙을 서버사이드에서
 * 직접 파싱할 수 없다. 대신 공개된 Schema.org 카탈로그 엔드포인트를 활용한다.
 *
 * 흐름:
 *   detailUrl (data.go.kr/data/{id}/openapi.do)
 *     → publicDataPk 추출
 *     → https://www.data.go.kr/catalog/{id}/openapi.json 조회
 *     → DatasetDetailOutput 반환 (메타데이터 + 상세페이지 링크)
 */

import type { DatasetDetailOutput } from "../types/index.js";
import { MemoryCache, TTL } from "../cache/memoryCache.js";
import { logger } from "../utils/logger.js";
import { fetchWithRetry } from "../utils/retry.js";

const detailCache = new MemoryCache<DatasetDetailOutput>(TTL.DETAIL);

const PORTAL_BASE = "https://www.data.go.kr";

/** detailUrl에서 publicDataPk 추출 */
function extractPublicDataPk(detailUrl: string): string | null {
  const m = detailUrl.match(/\/data\/(\d+)\//);
  return m ? m[1] : null;
}

/** Schema.org 카탈로그 JSON → DatasetDetailOutput 변환 */
function catalogToOutput(
  catalog: Record<string, unknown>,
  detailUrl: string,
  pk: string
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

  // API 명세는 브라우저를 통해서만 접근 가능하므로 링크 안내
  const oasViewerUrl = `${PORTAL_BASE}/data/${pk}/openapi.do`;

  return {
    title: String(catalog["name"] ?? ""),
    provider,
    // 실제 API base URL은 JS 렌더링 없이 알 수 없어 빈 문자열
    baseUrl: "",
    endpoints: [],
    authMethod:
      "공공데이터포털 인증키(serviceKey) — 활용 신청 후 data.go.kr 마이페이지에서 발급",
    swaggerUrl: oasViewerUrl,
    detailPageUrl: detailUrl,
    // 추가 메타데이터를 note로 제공
    note: [
      `응답 형식: ${encodingFormat || "정보 없음"}`,
      `업데이트 주기: ${datasetTimeInterval || "정보 없음"}`,
      `라이선스: ${license || "정보 없음"}`,
      `최근 수정일: ${dateModified || "정보 없음"}`,
      keywords.length > 0 ? `태그: ${keywords.join(", ")}` : "",
      `API 명세 확인: ${oasViewerUrl} (브라우저 접속 후 Swagger UI 탭)`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
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

  // detailUrl에서 publicDataPk 추출
  const pk = extractPublicDataPk(detailUrl);
  if (!pk) {
    return buildNotFound(detailUrl, "URL에서 데이터셋 ID를 추출할 수 없습니다.");
  }

  // Schema.org 카탈로그 엔드포인트 조회
  const catalogUrl = `${PORTAL_BASE}/catalog/${pk}/openapi.json`;
  logger.info("카탈로그 조회", { catalogUrl });

  let catalog: Record<string, unknown>;
  try {
    const res = await fetchWithRetry(
      catalogUrl,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          Referer: PORTAL_BASE + "/",
        },
      },
      { maxAttempts: 2, timeoutMs: 8000 }
    );

    if (!res.ok) {
      logger.warn("카탈로그 응답 비정상", { status: res.status, pk });
      return buildNotFound(
        detailUrl,
        `카탈로그 조회 실패 (HTTP ${res.status}). 상세 페이지를 직접 확인하세요.`
      );
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) {
      const text = await res.text();
      if (text.includes("에러")) {
        return buildNotFound(
          detailUrl,
          "데이터셋을 찾을 수 없습니다. URL을 확인하거나 data.go.kr에서 직접 검색하세요."
        );
      }
    }

    catalog = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    logger.error("카탈로그 조회 오류", err);
    return buildNotFound(detailUrl, `네트워크 오류: ${String(err)}`);
  }

  const result = catalogToOutput(catalog, detailUrl, pk);
  detailCache.set(cacheKey, result, TTL.DETAIL);
  return result;
}

function buildNotFound(detailUrl: string, reason: string): DatasetDetailOutput {
  const pk = extractPublicDataPk(detailUrl);
  const oasViewerUrl = pk
    ? `${PORTAL_BASE}/data/${pk}/openapi.do`
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
