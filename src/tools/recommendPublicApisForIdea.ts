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

// ─── 기관명 별칭 → 공식명 매핑 ────────────────────────────────────────────────
// 사용자가 약칭으로 언급한 기관을 공식 이름으로 변환해 organizations 필터에 활용

const ORG_ALIASES: Record<string, string> = {
  심평원: "건강보험심사평가원",
  건보공단: "국민건강보험공단",
  건강보험공단: "국민건강보험공단",
  국토부: "국토교통부",
  교육부: "교육부",
  복지부: "보건복지부",
  보건복지부: "보건복지부",
  환경부: "환경부",
  행안부: "행정안전부",
  농식품부: "농림축산식품부",
  농림부: "농림축산식품부",
  통계청: "통계청",
  기상청: "기상청",
  경찰청: "경찰청",
  소방청: "소방청",
  문체부: "문화체육관광부",
  고용부: "고용노동부",
  과기부: "과학기술정보통신부",
  중기부: "중소벤처기업부",
  금융위: "금융위원회",
  금융감독원: "금융감독원",
  건보: "국민건강보험공단",
};

/** 아이디어 텍스트에서 감지된 기관명 공식명 반환 */
function detectOrganizations(text: string): string[] {
  const found = new Set<string>();
  const lower = text.toLowerCase();
  for (const [alias, official] of Object.entries(ORG_ALIASES)) {
    if (lower.includes(alias) || text.includes(alias)) {
      found.add(official);
    }
  }
  return [...found];
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

  // 2. 검색 쿼리 구성
  //    - 키워드 최대 5개 (기존 3개에서 확장)
  //    - 기관명 감지 시 organizations 필터로 별도 검색 추가
  const searchQueries = keywords.slice(0, 5);
  if (searchQueries.length === 0) {
    searchQueries.push(ideaText.slice(0, 20));
  }

  const detectedOrgs = detectOrganizations(ideaText + " " + (domainHint ?? ""));
  logger.info("감지된 기관명", { detectedOrgs });

  // 3. 검색 API 병렬 호출
  const serviceKey = getServiceKey();

  const searches = [
    // 키워드별 일반 검색 (FILE+API+STD 전체)
    ...searchQueries.map((kw) =>
      searchPublicDatasets({ keyword: kw, size: 20 }, serviceKey)
    ),
    // 기관명 감지 시 organization 필터 검색 추가
    ...detectedOrgs.map((org) =>
      searchPublicDatasets(
        { keyword: keywords[0] ?? "", size: 20, organizations: [org] },
        serviceKey
      )
    ),
  ];

  const fetchResults = await Promise.allSettled(searches);

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
