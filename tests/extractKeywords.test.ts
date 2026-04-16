import { describe, it, expect } from "vitest";
import { extractKeywords } from "../src/parsers/extractKeywords.js";

describe("extractKeywords", () => {
  it("축제 앱 아이디어에서 핵심 키워드를 추출한다", () => {
    const { keywords } = extractKeywords(
      "대한민국 지역 축제 시작 전에 알림을 주는 앱을 만들고 싶어"
    );
    expect(keywords).toContain("축제");
    expect(keywords).toContain("지역");
    expect(keywords).toContain("알림");
  });

  it("도메인 확장이 동작한다 — 축제 → 행사 추가", () => {
    const { keywords } = extractKeywords("축제 일정 앱");
    expect(keywords).toContain("축제");
    expect(keywords).toContain("행사");
  });

  it("병원 비급여 서비스에서 의료 관련 키워드가 추출된다", () => {
    const { keywords } = extractKeywords("병원 비급여 비교 서비스");
    expect(keywords).toContain("병원");
    expect(keywords).toContain("비급여");
  });

  it("실시간 키워드가 포함되면 isRealtimeHinted가 true다", () => {
    const { isRealtimeHinted } = extractKeywords("실시간 버스 위치 앱");
    expect(isRealtimeHinted).toBe(true);
  });

  it("실시간 키워드가 없으면 isRealtimeHinted가 false다", () => {
    const { isRealtimeHinted } = extractKeywords("축제 정보 앱");
    expect(isRealtimeHinted).toBe(false);
  });

  it("domainHint가 주어지면 관련 키워드가 추가된다", () => {
    const { keywords } = extractKeywords("알림 앱 만들기", "교통");
    expect(keywords).toContain("교통");
    expect(keywords).toContain("버스");
  });

  it("키워드는 최대 8개를 넘지 않는다", () => {
    const { keywords } = extractKeywords(
      "축제 병원 교통 날씨 음식 관광 취업 복지 환경 통계"
    );
    expect(keywords.length).toBeLessThanOrEqual(8);
  });

  it("불용어만 있는 입력은 빈 배열을 반환한다", () => {
    const { keywords } = extractKeywords("을 를 이 가 은 는");
    expect(keywords.length).toBe(0);
  });
});
