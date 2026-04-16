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

describe("searchPublicDatasets (odcloud API)", () => {
  it("data 배열 형태 응답을 파싱한다", async () => {
    const mockBody = {
      currentCount: 2,
      totalCount: 2,
      data: [
        {
          id: "1",
          title: "지역축제정보",
          org_nm: "문화체육관광부",
          data_type: "오픈API",
          desc: "지역 축제 행사 정보",
          update_cycle: "수시",
        },
        {
          id: "2",
          title: "행사정보",
          org_nm: "행안부",
          data_type: "파일데이터",
          desc: "행사 정보",
        },
      ],
    };
    const result = await searchPublicDatasets(
      { keyword: "축제" },
      MOCK_KEY,
      makeFetch(mockBody)
    );
    expect(result).toHaveLength(2);
    expect(result[0]?.title).toBe("지역축제정보");
    expect(result[0]?.orgNm).toBe("문화체육관광부");
    expect(result[0]?.serviceType).toBe("OpenAPI");
  });

  it("Authorization 헤더에 serviceKey가 포함된다", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    }) as unknown as typeof fetch;

    await searchPublicDatasets({ keyword: "테스트" }, MOCK_KEY, mockFetch);

    const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = callArgs[1]?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Infuser ${MOCK_KEY}`);
  });

  it("API 오류 응답(code < 0)이면 에러를 throw한다", async () => {
    const errBody = { code: -401, msg: "유효하지 않은 인증키 입니다." };
    await expect(
      searchPublicDatasets({ keyword: "축제" }, MOCK_KEY, makeFetch(errBody))
    ).rejects.toThrow("유효하지 않은 인증키 입니다.");
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
