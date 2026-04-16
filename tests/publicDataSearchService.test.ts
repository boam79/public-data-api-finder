import { describe, it, expect, vi } from "vitest";
import { searchPublicDatasets } from "../src/services/publicDataSearchService.js";

function makeFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

const MOCK_KEY = "test-service-key";

describe("searchPublicDatasets", () => {
  it("data 배열 형태 응답을 파싱한다", async () => {
    const mockBody = {
      currentCount: 2,
      totalCount: 2,
      data: [
        { title: "지역축제정보", orgNm: "문화체육관광부", serviceType: "OpenAPI" },
        { title: "행사정보", orgNm: "행안부", serviceType: "OpenAPI" },
      ],
    };
    const result = await searchPublicDatasets(
      { keyword: "축제" },
      MOCK_KEY,
      makeFetch(mockBody)
    );
    expect(result).toHaveLength(2);
    expect(result[0]?.title).toBe("지역축제정보");
  });

  it("response.body.items.item 구조를 파싱한다", async () => {
    const mockBody = {
      response: {
        header: { resultCode: "00" },
        body: {
          items: {
            item: [{ title: "축제일정", orgNm: "한국관광공사" }],
          },
          totalCount: 1,
        },
      },
    };
    const result = await searchPublicDatasets(
      { keyword: "축제" },
      MOCK_KEY,
      makeFetch(mockBody)
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("축제일정");
  });

  it("HTTP 오류 시 에러를 throw한다", async () => {
    await expect(
      searchPublicDatasets({ keyword: "축제" }, MOCK_KEY, makeFetch({}, 500))
    ).rejects.toThrow("HTTP 500");
  });

  it("네트워크 장애 시 에러를 throw한다", async () => {
    const brokenFetch = vi
      .fn()
      .mockRejectedValue(new Error("network failure")) as unknown as typeof fetch;
    await expect(
      searchPublicDatasets({ keyword: "축제" }, MOCK_KEY, brokenFetch)
    ).rejects.toThrow("네트워크 오류");
  });

  it("빈 data 배열이면 빈 배열을 반환한다", async () => {
    const result = await searchPublicDatasets(
      { keyword: "없는데이터" },
      MOCK_KEY,
      makeFetch({ currentCount: 0, totalCount: 0, data: [] })
    );
    expect(result).toHaveLength(0);
  });
});
