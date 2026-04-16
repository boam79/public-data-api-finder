/**
 * search_public_datasets tool — 키워드 기반 raw 검색.
 * 디버깅 및 직접 검색 용도.
 */

import type { SearchInput, SearchOutput } from "../types/index.js";
import { searchPublicDatasets as callSearchApi, getServiceKey } from "../services/publicDataSearchService.js";
import { MemoryCache, normalizeCacheKey } from "../cache/memoryCache.js";

const searchCache = new MemoryCache<SearchOutput>(3 * 60 * 1000);

export async function searchPublicDatasetsForTool(
  input: SearchInput
): Promise<SearchOutput> {
  const { query, page = 1, limit = 10 } = input;
  const cacheKey = normalizeCacheKey(`search|${query}|${page}|${limit}`);

  const cached = searchCache.get(cacheKey);
  if (cached) return cached;

  const serviceKey = getServiceKey();
  const rawItems = await callSearchApi(
    { keyword: query, perPage: limit, page },
    serviceKey
  );

  const output: SearchOutput = {
    query,
    items: rawItems.map((item) => ({
      title: item.title ?? "제목 없음",
      summary: item.description?.slice(0, 100),
      provider: item.orgNm,
      detailUrl: item.detailUrl,
    })),
  };

  searchCache.set(cacheKey, output);
  return output;
}
