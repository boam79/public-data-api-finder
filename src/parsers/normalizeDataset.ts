/**
 * 검색 API 응답의 RawSearchItem을 내부 NormalizedDataset으로 변환한다.
 * 다양한 응답 구조 차이를 이 레이어에서 흡수한다.
 */

import type { NormalizedDataset, RawSearchItem, DatasetType } from "../types/index.js";

const PORTAL_BASE = "https://www.data.go.kr";

function resolveType(raw: RawSearchItem): DatasetType {
  const st = (raw.serviceType ?? "").toLowerCase();
  const at = (raw.apiType ?? "").toLowerCase();

  if (
    st.includes("openapi") ||
    st.includes("api") ||
    at.includes("rest") ||
    at.includes("soap")
  ) {
    return "API";
  }
  if (st.includes("파일") || st.includes("file")) {
    return "FILE";
  }
  return "UNKNOWN";
}

function resolveDetailUrl(raw: RawSearchItem): string {
  if (raw.detailUrl && raw.detailUrl.startsWith("http")) {
    return raw.detailUrl;
  }
  if (raw.id) {
    return `${PORTAL_BASE}/data/${raw.id}/openapi.do`;
  }
  return PORTAL_BASE;
}

function resolveUpdateCycle(raw: RawSearchItem): string {
  return raw.cycle ?? raw.lastUpdtDt ?? "미확인";
}

let idCounter = 0;

export function normalizeDataset(raw: RawSearchItem): NormalizedDataset {
  return {
    id: raw.id ?? `gen-${++idCounter}`,
    title: (raw.title ?? "제목 없음").trim(),
    provider: (raw.orgNm ?? "미상").trim(),
    type: resolveType(raw),
    description: (raw.description ?? "").trim(),
    updateCycle: resolveUpdateCycle(raw),
    detailUrl: resolveDetailUrl(raw),
    _raw: raw,
  };
}

export function normalizeDatasets(items: RawSearchItem[]): NormalizedDataset[] {
  return items.map(normalizeDataset);
}

/** 중복 제목 제거 (같은 제목 중 첫 번째만 유지) */
export function deduplicateByTitle(
  datasets: NormalizedDataset[]
): NormalizedDataset[] {
  const seen = new Set<string>();
  return datasets.filter((d) => {
    const key = d.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
