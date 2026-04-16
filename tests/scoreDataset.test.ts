import { describe, it, expect } from "vitest";
import { scoreAndRank } from "../src/ranking/scoreDataset.js";
import type { NormalizedDataset } from "../src/types/index.js";

function makeDataset(overrides: Partial<NormalizedDataset>): NormalizedDataset {
  return {
    id: "test-1",
    title: "테스트 데이터셋",
    provider: "테스트기관",
    type: "UNKNOWN",
    description: "",
    updateCycle: "미확인",
    lastUpdated: "2025-01-01",
    detailUrl: "https://example.com",
    tags: [],
    coreData: false,
    corpApi: false,
    _raw: {},
    ...overrides,
  };
}

describe("scoreAndRank", () => {
  it("키워드 매칭이 높은 데이터셋이 상위에 온다", () => {
    const datasets = [
      makeDataset({ id: "1", title: "버스 노선 정보", description: "버스 운행 정보", type: "API" }),
      makeDataset({ id: "2", title: "전국 음식점 현황", description: "음식점 목록", type: "FILE" }),
      makeDataset({ id: "3", title: "지역 축제 정보", description: "지역 축제 행사 일정", type: "API" }),
    ];

    const ctx = { keywords: ["축제", "행사", "지역"], apiOnly: false, realtimePreferred: false };
    const ranked = scoreAndRank(datasets, ctx);

    expect(ranked[0]!.title).toBe("지역 축제 정보");
  });

  it("apiOnly=true이면 FILE 타입은 결과에서 제거된다", () => {
    const datasets = [
      makeDataset({ id: "1", title: "축제 API", type: "API" }),
      makeDataset({ id: "2", title: "축제 파일", type: "FILE" }),
    ];
    const ctx = { keywords: ["축제"], apiOnly: true, realtimePreferred: false };
    const ranked = scoreAndRank(datasets, ctx);

    expect(ranked.every((r) => r.type === "API")).toBe(true);
    expect(ranked).toHaveLength(1);
  });

  it("realtimePreferred=true이면 실시간 데이터셋이 boost된다", () => {
    const datasets = [
      makeDataset({ id: "1", title: "축제 월별 통계", type: "API", updateCycle: "월1회" }),
      makeDataset({ id: "2", title: "축제 실시간 현황", type: "API", updateCycle: "실시간" }),
    ];
    const ctx = { keywords: ["축제"], apiOnly: false, realtimePreferred: true };
    const ranked = scoreAndRank(datasets, ctx);

    expect(ranked[0]!.title).toBe("축제 실시간 현황");
  });

  it("API형 데이터셋이 FILE형보다 높은 점수를 받는다", () => {
    const api = makeDataset({ id: "1", title: "같은 제목", type: "API", description: "설명" });
    const file = makeDataset({ id: "2", title: "같은 제목", type: "FILE", description: "설명" });

    const ctx = { keywords: [], apiOnly: false, realtimePreferred: false };
    const ranked = scoreAndRank([file, api], ctx);

    expect(ranked[0]!.type).toBe("API");
  });

  it("결과는 내림차순 정렬되어 있다", () => {
    const datasets = [
      makeDataset({ id: "1", title: "저관련 데이터", type: "FILE" }),
      makeDataset({ id: "2", title: "고관련 축제 API", type: "API", description: "축제 행사 지역 일정 정보" }),
    ];
    const ctx = { keywords: ["축제", "행사"], apiOnly: false, realtimePreferred: false };
    const ranked = scoreAndRank(datasets, ctx);

    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1]!.score).toBeGreaterThanOrEqual(ranked[i]!.score);
    }
  });
});
