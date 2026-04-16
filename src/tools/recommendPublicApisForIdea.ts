/**
 * recommend_public_apis_for_idea 핵심 로직.
 * 키워드 추출 → 검색 → 정규화 → 점수화 → 상위 N개 반환.
 */

import type {
  RecommendInput,
  RecommendOutput,
  NormalizedDataset,
} from "../types/index.js";
import { extractKeywords } from "../parsers/extractKeywords.js";
import { searchPublicDatasets, getServiceKey } from "../services/publicDataSearchService.js";
import { normalizeDatasets, deduplicateByTitle } from "../parsers/normalizeDataset.js";
import { scoreAndRank } from "../ranking/scoreDataset.js";
import { MemoryCache, normalizeCacheKey, isRealtimeQuery, TTL } from "../cache/memoryCache.js";
import { logger } from "../utils/logger.js";

const resultCache = new MemoryCache<RecommendOutput>(5 * 60 * 1000);

/** 아이디어 요약 — 첫 30자 + 말줄임표 */
function summarize(text: string): string {
  return text.length > 30 ? text.slice(0, 30) + "..." : text;
}

export async function recommendPublicApisForIdea(
  input: RecommendInput
): Promise<RecommendOutput> {
  const {
    ideaText,
    apiOnly = false,
    realtimePreferred = false,
    domainHint,
    limit = 5,
  } = input;

  const cacheKey = normalizeCacheKey(
    `${ideaText}|${apiOnly}|${realtimePreferred}|${domainHint ?? ""}|${limit}`
  );

  const cached = resultCache.get(cacheKey);
  if (cached) {
    logger.info("캐시 히트", { cacheKey });
    return cached;
  }

  // 1. 키워드 추출
  const { keywords, isRealtimeHinted } = extractKeywords(ideaText, domainHint);
  const effectiveRealtime = realtimePreferred || isRealtimeHinted;

  logger.info("추출된 키워드", { keywords, effectiveRealtime });

  // 2. 검색 쿼리 생성 — 키워드를 최대 3개 조합
  const searchQueries = keywords.slice(0, 3);
  if (searchQueries.length === 0) {
    searchQueries.push(ideaText.slice(0, 20));
  }

  // 3. 검색 API 호출 (키워드별 병렬 호출)
  const serviceKey = getServiceKey();
  const fetchResults = await Promise.allSettled(
    searchQueries.map((kw) =>
      searchPublicDatasets({ keyword: kw, size: 10 }, serviceKey)
    )
  );

  // 실패한 검색의 오류 메시지 수집
  const errors = fetchResults
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));

  const rawItems = fetchResults
    .filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof searchPublicDatasets>>> =>
        r.status === "fulfilled"
    )
    .flatMap((r) => r.value);

  logger.info("검색 결과 수집", { count: rawItems.length, errors });

  // 모든 검색이 실패한 경우 — 빈 결과 대신 명확한 오류를 throw
  if (rawItems.length === 0 && errors.length > 0) {
    const firstError = errors[0] ?? "알 수 없는 오류";
    const isAvailability =
      firstError.includes("타임아웃") ||
      firstError.includes("네트워크") ||
      firstError.includes("HTTP 5");

    throw new Error(
      isAvailability
        ? `공공데이터포털 API 일시 불가: ${firstError}. 잠시 후 다시 시도해 주세요.`
        : firstError
    );
  }

  // 4. 정규화 + 중복 제거
  const normalized: NormalizedDataset[] = deduplicateByTitle(
    normalizeDatasets(rawItems)
  );

  // 5. 점수화 + 정렬 + 상위 N개
  const ranked = scoreAndRank(normalized, {
    keywords,
    apiOnly,
    realtimePreferred: effectiveRealtime,
  }).slice(0, limit);

  const output: RecommendOutput = {
    ideaSummary: summarize(ideaText),
    extractedKeywords: keywords,
    recommendations: ranked,
    ...(errors.length > 0 && {
      warning: `일부 키워드 검색 실패: ${errors.join("; ")}`,
    }),
  };

  const ttl = isRealtimeQuery(ideaText) ? TTL.REALTIME : TTL.DEFAULT;
  resultCache.set(cacheKey, output, ttl);
  return output;
}
