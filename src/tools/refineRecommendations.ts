/**
 * 기존 추천 결과를 재검색 없이 재필터링/재정렬한다.
 * 토큰·외부 API 호출 절감의 핵심 기능.
 */

import type { RefineInput, RefineOutput, Recommendation } from "../types/index.js";

export function refineRecommendations(input: RefineInput): RefineOutput {
  const { previousResults, apiOnly, realtimePreferred, providerIncludes } = input;

  let results: Recommendation[] = [...previousResults];

  // API형만 필터
  if (apiOnly) {
    results = results.filter((r) => r.type === "API");
  }

  // 특정 제공기관 포함 필터
  if (providerIncludes) {
    const lower = providerIncludes.toLowerCase();
    results = results.filter((r) => r.provider.toLowerCase().includes(lower));
  }

  // 실시간 우선 재정렬
  if (realtimePreferred) {
    results = results.slice().sort((a, b) => {
      const rtScore = (s: string) => {
        const c = s.toLowerCase();
        if (c.includes("실시간") || c.includes("매일")) return 2;
        if (c.includes("주")) return 1;
        return 0;
      };
      const diff = rtScore(b.updateCycle) - rtScore(a.updateCycle);
      if (diff !== 0) return diff;
      return b.score - a.score;
    });
  }

  return { recommendations: results };
}
