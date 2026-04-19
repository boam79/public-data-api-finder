#!/usr/bin/env node
/**
 * Public Data API Finder — MCP 서버 진입점
 * Claude Desktop / Cursor 등 MCP 클라이언트와 stdio로 통신한다.
 */

import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { recommendPublicApisForIdea } from "./tools/recommendPublicApisForIdea.js";
import { searchPublicDatasetsForTool } from "./tools/searchPublicDatasets.js";
import { refineRecommendations } from "./tools/refineRecommendations.js";
import { getDatasetDetail } from "./tools/getDatasetDetail.js";
import type { RefineInput, RecommendInput, SearchInput } from "./types/index.js";
import { logger } from "./utils/logger.js";

// ─── Zod 스키마 ────────────────────────────────────────────────────────────────

const RecommendInputSchema = z.object({
  ideaText: z.string().min(1, "아이디어 텍스트를 입력하세요"),
  apiOnly: z.boolean().optional(),
  realtimePreferred: z.boolean().optional(),
  domainHint: z.string().optional(),
  limit: z.number().int().min(1).max(10).optional(),
});

const SearchInputSchema = z.object({
  query: z.string().min(1),
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const DatasetDetailInputSchema = z.object({
  detailUrl: z.string().url("유효한 URL을 입력하세요"),
});

const RefineInputSchema = z.object({
  previousResults: z.array(
    z.object({
      title: z.string(),
      provider: z.string(),
      type: z.enum(["API", "FILE", "UNKNOWN"]),
      updateCycle: z.string(),
      reason: z.string(),
      score: z.number(),
      detailUrl: z.string(),
    })
  ),
  apiOnly: z.boolean().optional(),
  realtimePreferred: z.boolean().optional(),
  providerIncludes: z.string().optional(),
});

// ─── 서버 생성 ────────────────────────────────────────────────────────────────

const server = new Server(
  {
    name: "public-data-api-finder",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ─── 도구 목록 ────────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "recommend_public_apis_for_idea",
      description:
        "자연어로 아이디어를 설명하면 공공데이터포털에서 적합한 API 후보를 추천합니다. 검색·정규화·점수화를 자동으로 수행하고 상위 결과를 반환합니다.",
      inputSchema: {
        type: "object",
        properties: {
          ideaText: {
            type: "string",
            description: "만들고 싶은 서비스/앱의 아이디어를 자연어로 설명하세요 (한국어 권장)",
          },
          apiOnly: {
            type: "boolean",
            description: "true이면 API형 데이터만 반환합니다 (파일데이터 제외)",
          },
          realtimePreferred: {
            type: "boolean",
            description: "true이면 실시간·고빈도 업데이트 데이터를 우선 정렬합니다",
          },
          domainHint: {
            type: "string",
            description: "검색 도메인 힌트 (예: '교통', '의료', '환경')",
          },
          limit: {
            type: "number",
            description: "최대 반환 추천 수 (기본 5, 최대 10)",
          },
        },
        required: ["ideaText"],
      },
    },
    {
      name: "search_public_datasets",
      description:
        "공공데이터포털에서 키워드로 데이터셋을 직접 검색합니다. 원시 검색 결과를 반환합니다.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "검색 키워드",
          },
          page: {
            type: "number",
            description: "페이지 번호 (기본 1)",
          },
          limit: {
            type: "number",
            description: "결과 수 (기본 10)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "get_dataset_detail",
      description:
        "공공데이터셋 상세 메타데이터를 조회합니다. data.go.kr의 Schema.org 카탈로그 API를 통해 데이터셋 이름, 제공기관, 응답 형식, 업데이트 주기, 라이선스, 태그, 최근 수정일을 반환합니다. " +
        "※ data.go.kr은 SPA 구조이므로 Swagger 엔드포인트·파라미터 상세는 서버사이드에서 조회 불가합니다. " +
        "API 명세(엔드포인트/파라미터)가 필요한 경우 반환된 swaggerUrl을 브라우저에서 직접 확인하세요.",
      inputSchema: {
        type: "object",
        properties: {
          detailUrl: {
            type: "string",
            description:
              "data.go.kr 데이터셋 상세 페이지 URL (예: https://www.data.go.kr/data/15006969/openapi.do)",
          },
        },
        required: ["detailUrl"],
      },
    },
    {
      name: "refine_recommendations",
      description:
        "이전 추천 결과를 재검색 없이 조건에 맞게 재필터링/재정렬합니다. 토큰과 API 호출을 절약합니다.",
      inputSchema: {
        type: "object",
        properties: {
          previousResults: {
            type: "array",
            description: "recommend_public_apis_for_idea가 반환한 recommendations 배열",
            items: { type: "object" },
          },
          apiOnly: {
            type: "boolean",
            description: "API형만 남깁니다",
          },
          realtimePreferred: {
            type: "boolean",
            description: "실시간 데이터를 앞으로 정렬합니다",
          },
          providerIncludes: {
            type: "string",
            description: "특정 제공기관 이름 포함 필터 (예: '국토교통부')",
          },
        },
        required: ["previousResults"],
      },
    },
  ],
}));

// ─── 도구 호출 핸들러 ─────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "recommend_public_apis_for_idea") {
      const input = RecommendInputSchema.parse(args) as RecommendInput;
      const result = await recommendPublicApisForIdea(input);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    if (name === "search_public_datasets") {
      const input = SearchInputSchema.parse(args) as SearchInput;
      const result = await searchPublicDatasetsForTool(input);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    if (name === "get_dataset_detail") {
      const { detailUrl } = DatasetDetailInputSchema.parse(args);
      const result = await getDatasetDetail(detailUrl);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    if (name === "refine_recommendations") {
      const input = RefineInputSchema.parse(args) as RefineInput;
      const result = refineRecommendations(input);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    return {
      content: [{ type: "text", text: `알 수 없는 도구: ${name}` }],
      isError: true,
    };
  } catch (err) {
    logger.error(`도구 호출 오류 [${name}]`, err);
    const message = err instanceof Error ? err.message : String(err);

    // MCP 스펙: isError:true + 사람이 읽을 수 있는 오류 메시지 반환
    // AI 어시스턴트가 오류 원인을 파악하고 사용자에게 설명할 수 있도록 상세 기술
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: true,
              message,
              tool: name,
              timestamp: new Date().toISOString(),
              hint: message.includes("일시 불가")
                ? "공공데이터포털 API 서버가 일시적으로 응답하지 않습니다. 30초~1분 후 재시도하세요."
                : message.includes("미신청") || message.includes("인증키")
                ? "data.go.kr에서 공공데이터포털 검색 서비스(ID:15112888) 활용 신청 및 인증키를 확인하세요."
                : "잠시 후 다시 시도하거나 관리자에게 문의하세요.",
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
});

// ─── 서버 시작 ────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Public Data API Finder MCP 서버 시작됨 (stdio)");
}

main().catch((err) => {
  logger.error("서버 시작 실패", err);
  process.exit(1);
});
