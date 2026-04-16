/**
 * NormalizedDataset에 점수를 부여한다.
 * 가중치: 도메인 적합도(40) + API형(20) + 업데이트 주기(15) + 지역성(15) + 설명 품질(10)
 */

import type { NormalizedDataset, Recommendation, ScoreContext } from "../types/index.js";

/** 업데이트 주기 문자열 → 실시간성 점수 (0~15) */
function cycleScore(cycle: string): number {
  const c = cycle.toLowerCase();
  if (c.includes("실시간") || c.includes("매일") || c.includes("daily")) return 15;
  if (c.includes("주") || c.includes("weekly")) return 10;
  if (c.includes("월") || c.includes("monthly")) return 7;
  if (c.includes("분기") || c.includes("반기")) return 4;
  if (c.includes("연") || c.includes("yearly") || c.includes("annual")) return 2;
  return 5; // 미확인
}

/** 키워드 포함 점수 (0~40) */
function domainScore(dataset: NormalizedDataset, keywords: string[]): number {
  const text = `${dataset.title} ${dataset.description} ${dataset.provider}`.toLowerCase();
  let matches = 0;
  for (const kw of keywords) {
    if (text.includes(kw.toLowerCase())) matches++;
  }
  if (keywords.length === 0) return 20;
  return Math.min(40, Math.round((matches / keywords.length) * 40));
}

/** 지역성 점수 (0~15) — 지역 관련 키워드 포함 여부 */
const REGION_TERMS = ["지역", "전국", "시", "군", "구", "도", "특별시", "광역시"];
function regionScore(dataset: NormalizedDataset, keywords: string[]): number {
  const hasRegionKw = keywords.some((kw) => REGION_TERMS.some((r) => kw.includes(r)));
  if (!hasRegionKw) return 7; // 지역성 무관 요청이면 중립
  const text = `${dataset.title} ${dataset.description}`.toLowerCase();
  const matches = REGION_TERMS.filter((r) => text.includes(r)).length;
  return Math.min(15, matches * 5);
}

/** 설명 품질 점수 (0~10) */
function descriptionScore(dataset: NormalizedDataset): number {
  const len = dataset.description.length;
  if (len > 80) return 10;
  if (len > 40) return 7;
  if (len > 10) return 4;
  return 0;
}

/** 추천 이유 텍스트 생성 */
function buildReason(
  dataset: NormalizedDataset,
  keywords: string[],
  score: number
): string {
  const matchedKws = keywords
    .filter((kw) =>
      `${dataset.title} ${dataset.description}`.toLowerCase().includes(kw.toLowerCase())
    )
    .slice(0, 3);

  const parts: string[] = [];
  if (matchedKws.length > 0) {
    parts.push(`'${matchedKws.join("', '")}'와(과) 관련됩니다`);
  }
  if (dataset.type === "API") {
    parts.push("OpenAPI 형태로 직접 호출 가능합니다");
  }
  if (dataset.provider && dataset.provider !== "미상") {
    parts.push(`${dataset.provider} 제공`);
  }
  if (parts.length === 0) parts.push("검색 결과에서 상위 매칭됩니다");
  return parts.join(". ") + `.`;
}

export function scoreAndRank(
  datasets: NormalizedDataset[],
  ctx: ScoreContext
): Recommendation[] {
  const { keywords, apiOnly, realtimePreferred } = ctx;

  return datasets
    .map((d) => {
      let score = 0;

      // 도메인 적합도 (40)
      score += domainScore(d, keywords);

      // API형 여부 (20)
      if (d.type === "API") score += 20;
      else if (d.type === "UNKNOWN") score += 5;

      // 업데이트 주기 (15)
      score += cycleScore(d.updateCycle);

      // 지역성 (15)
      score += regionScore(d, keywords);

      // 설명 품질 (10)
      score += descriptionScore(d);

      // 실시간 우선 요청 시 boost
      if (realtimePreferred && cycleScore(d.updateCycle) >= 12) {
        score += 10;
      }

      return {
        title: d.title,
        provider: d.provider,
        type: d.type,
        updateCycle: d.updateCycle,
        reason: buildReason(d, keywords, score),
        score,
        detailUrl: d.detailUrl,
      } satisfies Recommendation;
    })
    .filter((r) => !apiOnly || r.type === "API")
    .sort((a, b) => b.score - a.score);
}
