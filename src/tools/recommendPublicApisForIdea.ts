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
import { MemoryCache, normalizeCacheKey } from "../cache/memoryCache.js";
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
      searchPublicDatasets({ keyword: kw, perPage: 10 }, serviceKey)
    )
  );

  const rawItems = fetchResults
    .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof searchPublicDatasets>>> => r.status === "fulfilled")
    .flatMap((r) => r.value);

  logger.info("검색 결과 수집", { count: rawItems.length });

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
  };

  resultCache.set(cacheKey, output);
  return output;
}
