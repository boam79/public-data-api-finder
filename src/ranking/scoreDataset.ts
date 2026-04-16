/**
 * NormalizedDataset에 점수를 부여한다.
 *
 * 점수 구성 (총 100점 기준):
 *   도메인 적합도   40점  - 제목/설명/태그에 검색 키워드 포함 여부
 *   데이터 형태     20점  - API(20) > STD(10) > FILE(5) > UNKNOWN(3)
 *   업데이트 주기   10점  - 실시간/일별 데이터 우대
 *   최신성          10점  - 최근 수정일 우대 (최근 1년 만점)
 *   지역성          10점  - 지역 관련 요청 시 지역 데이터 우대
 *   설명 품질        5점  - 설명 길이/풍부도
 *   국가중점데이터   5점  - coreData === true 가산점
 *
 * 데이터 타입 점수:
 *   API=20, STD=10, FILE=5, UNKNOWN=3
 *   apiOnly=true 시 API 외 타입은 제거됨
 *
 * 패널티:
 *   기업전용(corpApi) API는 ctx.excludeCorpApi가 true(기본)일 때 필터 제외
 */

import type { NormalizedDataset, Recommendation, ScoreContext } from "../types/index.js";

// ─── 업데이트 주기 점수 (0~10) ────────────────────────────────────────────────

function cycleScore(cycle: string): number {
  const c = cycle.toLowerCase();
  if (c.includes("실시간") || c.includes("매일") || c.includes("daily")) return 10;
  if (c.includes("주") || c.includes("weekly")) return 7;
  if (c.includes("월") || c.includes("monthly")) return 5;
  if (c.includes("분기") || c.includes("반기")) return 3;
  if (c.includes("연") || c.includes("yearly") || c.includes("annual")) return 1;
  return 3; // 미확인
}

// ─── 최신성 점수 (0~10) — 최근 1년이면 만점 ──────────────────────────────────

function recencyScore(lastUpdated: string): number {
  if (!lastUpdated) return 3;
  const updated = new Date(lastUpdated).getTime();
  if (isNaN(updated)) return 3;
  const ageMs = Date.now() - updated;
  const ageMonths = ageMs / (1000 * 60 * 60 * 24 * 30);
  if (ageMonths <= 3) return 10;
  if (ageMonths <= 6) return 8;
  if (ageMonths <= 12) return 6;
  if (ageMonths <= 24) return 4;
  if (ageMonths <= 36) return 2;
  return 1;
}

// ─── 도메인 적합도 점수 (0~40) ────────────────────────────────────────────────

function domainScore(dataset: NormalizedDataset, keywords: string[]): number {
  if (keywords.length === 0) return 20;

  const titleText = dataset.title.toLowerCase();
  const bodyText = `${dataset.description} ${dataset.provider}`.toLowerCase();
  const tagText = dataset.tags.join(" ").toLowerCase();

  let matches = 0;
  let titleBonus = 0;
  let tagBonus = 0;

  for (const kw of keywords) {
    const k = kw.toLowerCase();
    if (titleText.includes(k)) {
      matches++;
      titleBonus += 2; // 제목 매칭은 추가 가중치
    } else if (bodyText.includes(k)) {
      matches++;
    }
    if (tagText.includes(k)) {
      tagBonus += 1; // 포털 태그 매칭 보너스
    }
  }

  const base = Math.round((matches / keywords.length) * 30);
  return Math.min(40, base + Math.min(6, titleBonus) + Math.min(4, tagBonus));
}

// ─── 지역성 점수 (0~10) ───────────────────────────────────────────────────────

const REGION_TERMS = ["지역", "전국", "시", "군", "구", "도", "특별시", "광역시"];

function regionScore(dataset: NormalizedDataset, keywords: string[]): number {
  const hasRegionKw = keywords.some((kw) => REGION_TERMS.some((r) => kw.includes(r)));
  if (!hasRegionKw) return 5; // 지역성 무관 요청이면 중립
  const text = `${dataset.title} ${dataset.description}`.toLowerCase();
  const matches = REGION_TERMS.filter((r) => text.includes(r)).length;
  return Math.min(10, matches * 3);
}

// ─── 설명 품질 점수 (0~5) ─────────────────────────────────────────────────────

function descriptionScore(dataset: NormalizedDataset): number {
  const len = dataset.description.length;
  if (len > 100) return 5;
  if (len > 50) return 4;
  if (len > 20) return 2;
  return 0;
}

// ─── 추천 이유 텍스트 생성 ────────────────────────────────────────────────────

function buildReason(dataset: NormalizedDataset, keywords: string[]): string {
  const matchedKws = keywords
    .filter((kw) =>
      `${dataset.title} ${dataset.description} ${dataset.tags.join(" ")}`
        .toLowerCase()
        .includes(kw.toLowerCase())
    )
    .slice(0, 3);

  const parts: string[] = [];

  if (matchedKws.length > 0) {
    parts.push(`'${matchedKws.join("', '")}'와(과) 관련됩니다`);
  }
  if (dataset.type === "API") {
    parts.push("OpenAPI 형태로 직접 호출 가능합니다");
  }
  if (dataset.coreData) {
    parts.push("국가중점데이터로 지정된 신뢰도 높은 데이터입니다");
  }
  if (dataset.tags.length > 0) {
    parts.push(`태그: ${dataset.tags.slice(0, 3).join(", ")}`);
  }
  if (dataset.provider && dataset.provider !== "미상") {
    parts.push(`${dataset.provider} 제공`);
  }

  if (parts.length === 0) parts.push("검색 결과에서 상위 매칭됩니다");
  return parts.join(". ") + ".";
}

// ─── 메인 점수화 함수 ─────────────────────────────────────────────────────────

export function scoreAndRank(
  datasets: NormalizedDataset[],
  ctx: ScoreContext
): Recommendation[] {
  const {
    keywords,
    apiOnly,
    realtimePreferred,
    excludeCorpApi = true,
  } = ctx;

  return datasets
    .filter((d) => {
      if (apiOnly && d.type !== "API") return false;
      if (excludeCorpApi && d.corpApi) return false;
      return true;
    })
    .map((d) => {
      let score = 0;

      score += domainScore(d, keywords);          // 최대 40
      // API(20) > STD(10) > FILE(5) > UNKNOWN(3) — 전체 검색 후 타입별 우대
      score += d.type === "API" ? 20 : d.type === "STD" ? 10 : d.type === "FILE" ? 5 : 3;
      score += cycleScore(d.updateCycle);          // 최대 10
      score += recencyScore(d.lastUpdated);        // 최대 10
      score += regionScore(d, keywords);           // 최대 10
      score += descriptionScore(d);               // 최대 5
      if (d.coreData) score += 5;                 // 국가중점데이터 가산점

      // 실시간 우선 요청 시 추가 boost
      if (realtimePreferred && cycleScore(d.updateCycle) >= 8) {
        score += 8;
      }

      return {
        title: d.title,
        provider: d.provider,
        type: d.type,
        updateCycle: d.updateCycle,
        reason: buildReason(d, keywords),
        score,
        detailUrl: d.detailUrl,
      } satisfies Recommendation;
    })
    .sort((a, b) => b.score - a.score);
}
