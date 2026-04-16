/**
 * get_dataset_detail — 데이터셋 상세 API 명세 조회 도구.
 *
 * data.go.kr 상세 페이지에서 Swagger spec URL을 추출한 뒤
 * spec을 파싱해 실제 호출 엔드포인트·파라미터·인증 방법을 반환한다.
 *
 * 흐름:
 *   detailUrl (data.go.kr/data/{id}/openapi.do)
 *     → HTML에서 infuser.odcloud.kr/api/stages/{stageId}/api-docs 추출
 *     → Swagger JSON 파싱
 *     → DatasetDetailOutput 반환
 */

import type { DatasetDetailOutput, ApiParameter } from "../types/index.js";
import { MemoryCache, TTL } from "../cache/memoryCache.js";
import { logger } from "../utils/logger.js";
import { withRetry } from "../utils/retry.js";

const detailCache = new MemoryCache<DatasetDetailOutput>(TTL.DETAIL);

/** data.go.kr HTML에서 Swagger spec URL을 추출 */
async function extractSwaggerUrl(detailPageUrl: string): Promise<string | null> {
  let html: string;
  try {
    const res = await withRetry(() =>
      fetch(detailPageUrl, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" },
      })
    );
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }

  const match = html.match(
    /https:\/\/infuser\.odcloud\.kr\/api\/stages\/(\d+)\/api-docs/
  );
  return match ? match[0] : null;
}

/** Swagger JSON에서 인증 방법 문자열 생성 */
function resolveAuthMethod(spec: Record<string, unknown>): string {
  const defs = spec["securityDefinitions"] as Record<string, unknown> | undefined;
  if (!defs) return "없음 (공개 API)";

  const methods: string[] = [];
  for (const [name, def] of Object.entries(defs)) {
    const d = def as Record<string, unknown>;
    if (d["in"] === "header" && d["name"]) {
      methods.push(`헤더: ${d["name"]} (예: Infuser {인증키})`);
    } else if (d["in"] === "query" && d["name"]) {
      methods.push(`쿼리 파라미터: ${d["name"]}`);
    } else {
      methods.push(name);
    }
  }
  return methods.join(", ") || "없음";
}

/** Swagger parameter → ApiParameter 매핑 */
function mapParam(p: Record<string, unknown>): ApiParameter {
  return {
    name: String(p["name"] ?? ""),
    in: (p["in"] as ApiParameter["in"]) ?? "query",
    required: p["required"] === true,
    type: String(p["type"] ?? p["schema"] ? "object" : "string"),
    description: String(p["description"] ?? ""),
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

  // 1. HTML에서 Swagger spec URL 추출
  const swaggerUrl = await extractSwaggerUrl(detailUrl);
  if (!swaggerUrl) {
    return {
      title: "상세 정보를 가져올 수 없습니다",
      provider: "",
      baseUrl: "",
      endpoints: [],
      authMethod: "알 수 없음",
      swaggerUrl: "",
      detailPageUrl: detailUrl,
    };
  }

  // 2. Swagger spec 조회
  let spec: Record<string, unknown>;
  try {
    const res = await withRetry(() =>
      fetch(swaggerUrl, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      })
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    spec = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    logger.error("Swagger spec 조회 실패", err);
    return {
      title: "API 명세를 가져올 수 없습니다",
      provider: "",
      baseUrl: swaggerUrl,
      endpoints: [],
      authMethod: "알 수 없음",
      swaggerUrl,
      detailPageUrl: detailUrl,
    };
  }

  // 3. spec 파싱
  const info = (spec["info"] as Record<string, unknown>) ?? {};
  const host = String(spec["host"] ?? "");
  const basePath = String(spec["basePath"] ?? "");
  const baseUrl = host ? `https://${host}${basePath}` : basePath;

  const paths = (spec["paths"] as Record<string, Record<string, unknown>>) ?? {};
  const endpoints = Object.entries(paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, opRaw]) => {
      const op = opRaw as Record<string, unknown>;
      const rawParams = (op["parameters"] as Record<string, unknown>[]) ?? [];
      return {
        method: method.toUpperCase(),
        path,
        summary: String(op["summary"] ?? op["description"] ?? ""),
        parameters: rawParams.map(mapParam),
      };
    })
  );

  const result: DatasetDetailOutput = {
    title: String(info["title"] ?? ""),
    provider: String(info["contact"] ?? ""),
    baseUrl,
    endpoints,
    authMethod: resolveAuthMethod(spec),
    swaggerUrl,
    detailPageUrl: detailUrl,
  };

  detailCache.set(cacheKey, result, TTL.DETAIL);
  return result;
}
