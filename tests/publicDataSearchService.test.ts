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

/** 검색 서비스 응답 형식: { statusCode, result: { sum, dataCount, data: [...] } } */
function makeSearchBody(items: object[]) {
  return {
    statusCode: 200,
    result: {
      sum: items.length,
      dataCount: items.length,
      data: items,
    },
  };
}

describe("searchPublicDatasets (공공데이터포털 검색 서비스 15112888)", () => {
  it("result.data 배열을 파싱한다", async () => {
    const mockBody = makeSearchBody([
      {
        dataName: "지역축제정보 서비스",
        organization: "문화체육관광부",
        dataType: "API",
        dataProvisionType: "REST",
        dataDescription: "지역 축제 행사 정보",
        updateDate: "2025-05-01",
        detailPageUrl: "https://www.data.go.kr/data/12345/openapi.do",
      },
      {
        dataName: "행사정보 파일",
        organization: "행안부",
        dataType: "FILE",
        dataDescription: "행사 정보",
      },
    ]);
    const result = await searchPublicDatasets(
      { keyword: "축제" },
      MOCK_KEY,
      makeFetch(mockBody)
    );
    expect(result).toHaveLength(2);
    expect(result[0]?.title).toBe("지역축제정보 서비스");
    expect(result[0]?.orgNm).toBe("문화체육관광부");
    expect(result[0]?.serviceType).toBe("OpenAPI");
    expect(result[0]?.detailUrl).toBe(
      "https://www.data.go.kr/data/12345/openapi.do"
    );
  });

  it("POST 요청이고 serviceKey가 쿼리 파라미터에 포함된다", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeSearchBody([]),
    }) as unknown as typeof fetch;

    await searchPublicDatasets({ keyword: "테스트" }, MOCK_KEY, mockFetch);

    const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const url = callArgs[0] as string;
    const init = callArgs[1] as RequestInit;

    expect(init.method).toBe("POST");
    expect(url).toContain("serviceKey=");
    expect(url).toContain(encodeURIComponent(MOCK_KEY));
  });

  it("요청 body에 keyword, page, size, dataType이 포함된다", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeSearchBody([]),
    }) as unknown as typeof fetch;

    await searchPublicDatasets(
      { keyword: "버스", size: 5, page: 2 },
      MOCK_KEY,
      mockFetch
    );

    const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(callArgs[1]?.body as string);
    expect(body.keyword).toBe("버스");
    expect(body.size).toBe(5);
    expect(body.page).toBe(2);
    expect(body.dataType).toContain("API");
  });

  it("API 오류 응답(code < 0)이면 에러를 throw한다", async () => {
    const errBody = { code: -4, msg: "등록되지 않은 인증키 입니다." };
    await expect(
      searchPublicDatasets({ keyword: "축제" }, MOCK_KEY, makeFetch(errBody, 400))
    ).rejects.toThrow("공공데이터 API 미신청");
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
      makeFetch(makeSearchBody([]))
    );
    expect(result).toHaveLength(0);
  });
});
