# public-data-api-finder MCP

> 한국 공공데이터포털(data.go.kr)의 공개 API를 **자연어로 검색하고 추천**해주는 Model Context Protocol(MCP) 서버

Claude, Cursor 등 MCP를 지원하는 AI 어시스턴트에 연결하면, 아이디어를 설명하는 것만으로 관련 공공 API를 자동으로 찾아 추천해줍니다.

---

## MCP란?

**Model Context Protocol(MCP)** 은 Anthropic이 만든 오픈 표준으로, AI 어시스턴트가 외부 도구·데이터 소스를 표준화된 방식으로 호출할 수 있게 하는 프로토콜입니다.

이 프로젝트는 MCP 서버로 동작하며, AI가 대화 중 필요하다고 판단하면 자동으로 공공데이터 검색 도구를 호출합니다. 사용자는 별도 코드를 짜거나 API를 직접 호출할 필요 없이, 자연어로 대화하기만 하면 됩니다.

```
사용자: "실시간 버스 위치 데이터가 필요한 앱을 만들고 싶어"
AI: (내부적으로 recommend_public_apis_for_idea 호출)
AI: "국토교통부_버스위치정보조회서비스 API를 추천합니다. 실시간 REST API로..."
```

---

## 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│                   AI 어시스턴트 (Claude / Cursor)          │
│                  (자연어 입력 처리 + 응답 생성)              │
└───────────────────────┬─────────────────────────────────┘
                        │ MCP (stdio)
                        ▼
┌─────────────────────────────────────────────────────────┐
│              public-data-api-finder MCP 서버              │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │  recommend_  │  │   search_    │  │  get_dataset_ │ │
│  │  public_apis │  │   public_    │  │    detail     │ │
│  │  _for_idea   │  │   datasets   │  │               │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬────────┘ │
│         │                 │                  │          │
│  ┌──────▼─────────────────▼──────────────────▼───────┐  │
│  │  키워드 추출 → 검색 → 정규화 → 점수화 → 캐시       │  │
│  └───────────────────────┬───────────────────────────┘  │
│                          │ 지수 백오프 재시도              │
└──────────────────────────┼──────────────────────────────┘
                           │ HTTPS POST (JSON)
                           ▼
┌─────────────────────────────────────────────────────────┐
│   공공데이터활용지원센터_공공데이터포털 검색 서비스 (ID: 15112888)  │
│       api.odcloud.kr/api/GetSearchDataList/v1/searchData  │
└─────────────────────────────────────────────────────────┘
```

---

## 제공 도구 (MCP Tools)

### 1. `recommend_public_apis_for_idea`

아이디어 텍스트를 입력하면 관련 공공 API를 **자동으로 검색·점수화·추천**합니다.

**내부 처리 흐름**
1. **키워드 추출** — 한국어 형태소 분석으로 핵심 키워드 추출, 도메인 동의어 확장 (예: "날씨" → 기상, 기온, 강수)
2. **병렬 검색** — 추출된 키워드별로 공공데이터 API를 동시 호출
3. **정규화** — 다양한 응답 구조를 내부 통일 포맷으로 변환 + 중복 제거
4. **점수화** — 아래 알고리즘으로 100점 만점 산출
5. **캐시 저장** — 동일 질의 재요청 시 API 재호출 없이 반환

**점수화 알고리즘**

| 항목 | 최대 점수 | 설명 |
|------|----------|------|
| 도메인 적합도 | 40점 | 제목·설명·태그에 검색 키워드 포함 여부. 제목 매칭 +2 가중치, 포털 태그 매칭 +1 추가 |
| API형 여부 | 20점 | OpenAPI(REST/SOAP) 형태면 만점. 파일형은 0점 |
| 업데이트 주기 | 10점 | 실시간/매일 10점 → 주간 7점 → 월간 5점 → 연간 1점 |
| 최신성 | 10점 | 최근 3개월 수정 10점 → 6개월 8점 → 1년 6점 → 3년 이상 1점 |
| 지역성 | 10점 | 지역 관련 요청 시 지역 데이터 우대 |
| 설명 품질 | 5점 | 설명 길이가 길수록 가점 |
| 국가중점데이터 | 5점 | 정부 지정 국가중점데이터 가산점 |

**파라미터**

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `ideaText` | string | ✅ | 아이디어 설명 (자연어, 한국어 권장) |
| `apiOnly` | boolean | ❌ | true면 OpenAPI 타입만 반환 |
| `realtimePreferred` | boolean | ❌ | true면 실시간 데이터 우선 정렬 + 부스트 |
| `domainHint` | string | ❌ | 도메인 힌트 (예: "교통", "의료") |
| `limit` | number | ❌ | 최대 추천 수 (기본 5, 최대 10) |

**예시 응답**

```json
{
  "ideaSummary": "지역 축제 알림 앱",
  "extractedKeywords": ["지역", "축제", "알림", "행사", "문화행사"],
  "recommendations": [
    {
      "title": "대전광역시 문화축제 정보",
      "provider": "대전광역시",
      "type": "API",
      "updateCycle": "2024-11-12",
      "score": 72,
      "reason": "'축제', '행사', '문화행사'와(과) 관련됩니다. OpenAPI 형태로 직접 호출 가능합니다. 대전광역시 제공.",
      "detailUrl": "https://www.data.go.kr/data/15006969/openapi.do"
    }
  ]
}
```

---

### 2. `get_dataset_detail`

추천된 데이터셋의 **실제 API 명세를 상세 조회**합니다. data.go.kr 상세 페이지에서 Swagger spec을 자동 파싱해 호출에 필요한 정보를 모두 반환합니다.

**파라미터**

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `detailUrl` | string | ✅ | data.go.kr 데이터셋 상세 URL |

**예시 응답**

```json
{
  "title": "공공데이터 포털 검색 서비스",
  "baseUrl": "https://api.odcloud.kr/api",
  "endpoints": [
    {
      "method": "POST",
      "path": "/GetSearchDataList/v1/searchData",
      "summary": "데이터셋 검색",
      "parameters": [
        { "name": "keyword", "in": "body", "required": false, "type": "string", "description": "검색어" },
        { "name": "page",    "in": "body", "required": false, "type": "integer", "description": "페이지 번호" },
        { "name": "size",    "in": "body", "required": false, "type": "integer", "description": "결과 수" }
      ]
    }
  ],
  "authMethod": "쿼리 파라미터: serviceKey",
  "swaggerUrl": "https://infuser.odcloud.kr/api/stages/43698/api-docs",
  "detailPageUrl": "https://www.data.go.kr/data/15112888/openapi.do"
}
```

---

### 3. `search_public_datasets`

키워드로 공공데이터를 **직접 검색**합니다. 추천 없이 원시 결과가 필요할 때 사용합니다.

**파라미터**

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `query` | string | ✅ | 검색 키워드 |
| `page` | number | ❌ | 페이지 번호 (기본 1) |
| `limit` | number | ❌ | 결과 수 (기본 10) |
| `dataType` | string[] | ❌ | 필터: `["API"]`, `["FILE"]`, `["API","FILE","STD"]` |
| `brm` | string | ❌ | 분류체계 필터 (예: "문화관광", "교통물류") |
| `updatedAfter` | string | ❌ | 수정일 이후 필터 (YYYY-MM-DD) |

---

### 4. `refine_recommendations`

이전 추천 결과를 **API 재호출 없이 재필터링·재정렬**합니다. 토큰과 API 호출 횟수를 절약합니다.

**파라미터**

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `previousResults` | array | ✅ | 이전 추천 결과 배열 |
| `apiOnly` | boolean | ❌ | OpenAPI 타입만 필터링 |
| `realtimePreferred` | boolean | ❌ | 실시간 데이터 앞으로 정렬 |
| `providerIncludes` | string | ❌ | 제공기관 이름 포함 필터 (예: "국토교통부") |

---

## 캐시 전략

| 쿼리 유형 | TTL | 설명 |
|-----------|-----|------|
| 실시간 키워드 (날씨, 교통 등) | 1분 | 최신 데이터 중요 |
| 일반 추천/검색 | 5분 | 기본값 |
| 데이터셋 상세 정보 | 30분 | API 명세는 자주 변경되지 않음 |

---

## 사전 요구사항

- **Node.js** 18 이상
- **pnpm** 8 이상
- **공공데이터포털 검색 서비스 API 키**
  1. [data.go.kr](https://www.data.go.kr) 회원가입 후 로그인
  2. [공공데이터활용지원센터_공공데이터포털 검색 서비스 (ID: 15112888)](https://www.data.go.kr/data/15112888/openapi.do) 활용 신청
  3. 마이페이지 → 데이터 활용 → Open API → 개발계정 상세보기에서 **일반 인증키(Encoding)** 복사

---

## 설치

```bash
git clone https://github.com/boam79/public-data-api-finder.git
cd public-data-api-finder
pnpm install
pnpm build
```

---

## 환경변수 설정

```bash
cp .env.example .env
```

`.env` 파일을 열어 발급받은 인증키(Encoding)를 입력합니다.

```env
PUBLIC_DATA_SERVICE_KEY=hIa%2BwCHFe509o...  # 발급받은 Encoding 키
```

> `.env` 파일은 `.gitignore`에 포함되어 있어 원격 저장소에 업로드되지 않습니다.

---

## Cursor에 MCP 등록

`~/.cursor/mcp.json` 파일에 추가합니다.

```json
{
  "mcpServers": {
    "public-data-api-finder": {
      "command": "node",
      "args": ["/절대경로/public-data-api-finder/dist/server.js"],
      "env": {
        "PUBLIC_DATA_SERVICE_KEY": "발급받은_인증키(Encoding)"
      }
    }
  }
}
```

Cursor를 재시작하면 AI 채팅에서 도구가 활성화됩니다.

---

## Claude Desktop에 MCP 등록

`~/Library/Application Support/Claude/claude_desktop_config.json` 파일에 추가합니다.

```json
{
  "mcpServers": {
    "public-data-api-finder": {
      "command": "node",
      "args": ["/절대경로/public-data-api-finder/dist/server.js"],
      "env": {
        "PUBLIC_DATA_SERVICE_KEY": "발급받은_인증키(Encoding)"
      }
    }
  }
}
```

Claude Desktop을 재시작하면 도구가 활성화됩니다.

---

## 개발

```bash
pnpm test    # vitest 단위 테스트 (20개)
pnpm build   # TypeScript 컴파일
pnpm dev     # 변경 감지 자동 재빌드
```

---

## 기술 스택

| 항목 | 내용 |
|------|------|
| 언어/런타임 | TypeScript, Node.js 18+ |
| MCP SDK | @modelcontextprotocol/sdk |
| 스키마 검증 | zod |
| 테스트 | vitest |
| 패키지 관리 | pnpm |
| 데이터 소스 | 공공데이터포털 검색 서비스 (ID: 15112888) |
| 인증 | serviceKey 쿼리 파라미터 |
| 캐시 | in-memory Map (TTL 차등 적용) |
| 오류 처리 | 지수 백오프 재시도 (최대 3회) |

---

## 버전 히스토리

| 버전 | 날짜 | 주요 변경 사항 |
|------|------|---------------|
| **v1.5.0** | 2026-04-19 | **파싱 오류/관련성 수정** — `get_dataset_detail` SPA 한계 해결(`/catalog/{id}/openapi.json` 방식으로 교체), 최소 점수 임계값(15점) 필터로 무관한 결과 제거, `K-Startup`/`R&D` 특수문자 키워드 정제(HTTP 500 방지), 도메인 확장 추가(나라장터/KOSIS/창업/조달) |
| **v1.4.0** | 2026-04-16 | **검색 범위 확장** — `dataType` 기본값 `["API"]`→`["FILE","API","STD"]`로 확장, 검색 키워드 3→5개, `size` 10→20, 기관명 자동 감지(`organizations` 필터), FILE/STD 타입 점수화 반영, 도메인 확장 사전 강화 (의료/기관) |
| v1.3.1 | 2026-04-16 | README 상세화 — 점수화 알고리즘 표, 캐시 전략, 설치/설정 가이드, 도구별 파라미터 상세 기술 |
| **v1.3.0** | 2026-04-16 | **고도화 (Phase 1/2/4)** — 다중 필터 검색(`dataType`/`brm`/`organizations`/날짜 범위), `get_dataset_detail` 신규 도구, 캐시 TTL 차등화(1분/5분/30분), 지수 백오프 재시도(최대 3회/8초 타임아웃), 점수화 100점 체계 완성 (`recencyScore`, `coreData` 보너스, 태그 매칭) |
| v1.2.1 | 2026-04-16 | `sort` 파라미터 오타 수정(`_sort`→`_score`) — HTTP 500 버그 해결, 구조화된 오류 응답 반환 |
| **v1.2.0** | 2026-04-16 | 공공데이터포털 검색 서비스 API 교체 (ID: 15077093→**15112888**) — POST 방식/JSON 바디/serviceKey 쿼리 파라미터, 기본 구현 완성 및 GitHub 최초 공개 |
| v1.1.0 | 2026-04-16 | MCP 서버 초기 구현 — `recommend_public_apis_for_idea`, `search_public_datasets`, `refine_recommendations` 3개 도구, 기본 점수화/캐시 |
| v1.0.0 | 2026-04-16 | 프로젝트 시작 — PRD 분석, 목록조회서비스(ID: 15077093) 연동 시도 |

### v1.0.0 → v1.4.0 주요 변화

| 항목 | v1.0.0 (초기) | v1.4.0 (현재) |
|------|--------------|--------------|
| API 엔드포인트 | 15077093 (미작동) | **15112888** (정상) |
| 인증 방식 | Authorization 헤더 | serviceKey 쿼리 파라미터 |
| 검색 타입 | API만 | **FILE + API + STD 전체** |
| 검색 size | 10개/키워드 | **20개/키워드** |
| 검색 키워드 수 | 3개 | **5개** |
| 기관명 필터 | 없음 | **자동 감지 후 organizations 적용** |
| 도구 수 | 3개 | **4개** (+ `get_dataset_detail`) |
| 점수화 항목 | 기본 3가지 | **7가지** (도메인/타입/주기/최신성/지역/설명/중점데이터) |
| FILE 타입 점수 | 0점 | **5점** (STD 10점, API 20점) |
| 캐시 TTL | 고정 5분 | **실시간 1분 / 기본 5분 / 상세 30분** |
| 오류 처리 | 단순 throw | **지수 백오프 재시도 + 구조화 오류 JSON** |
| 테스트 | 없음 | **vitest 20개 테스트** |

---

## 라이선스

MIT
