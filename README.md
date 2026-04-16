# public-data-api-finder

한국 공공데이터포털(data.go.kr)의 공개 API를 자연어로 검색하고 추천해주는 **MCP(Model Context Protocol) 서버**입니다.

AI 어시스턴트(Claude, Cursor 등)에게 "지역 축제 알림 앱 만들려는데 쓸 수 있는 공공 API 뭐 있어?" 라고 물으면, 관련 공공데이터 API 목록을 자동으로 찾아 추천해줍니다.

---

## 주요 기능


| 도구                               | 설명                                       |
| -------------------------------- | ---------------------------------------- |
| `recommend_public_apis_for_idea` | 아이디어 텍스트에서 키워드를 추출하고 관련 공공 API를 점수순으로 추천 |
| `search_public_datasets`         | 키워드로 공공데이터를 직접 검색 (raw 결과 반환)            |
| `refine_recommendations`         | 이전 추천 결과를 API만 보기, 실시간 선호, 제공기관 필터로 재정렬  |


---

## 아키텍처

```
사용자 자연어 입력
       ↓
  키워드 추출 (한국어 형태소 기반)
       ↓
  공공데이터포털 검색 서비스 API 호출 (병렬)
  POST api.odcloud.kr/api/GetSearchDataList/v1/searchData
       ↓
  응답 정규화 + 중복 제거
       ↓
  다차원 점수화 (키워드 매칭 / API 유형 / 실시간성 / 분류 / 설명)
       ↓
  상위 N개 추천 반환 + 인메모리 캐시
```

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
git clone https://github.com/YOUR_USERNAME/public-data-api-finder.git
cd public-data-api-finder
pnpm install
pnpm build
```

---

## 환경변수 설정

프로젝트 루트에 `.env` 파일을 생성합니다.

```bash
cp .env.example .env
```

`.env` 파일을 열어 발급받은 인증키를 입력합니다.

```env
PUBLIC_DATA_SERVICE_KEY=여기에_발급받은_인증키_입력
```

> **주의**: `.env` 파일은 `.gitignore`에 포함되어 있어 원격 저장소에 업로드되지 않습니다.

---

## Cursor에 MCP 등록

`~/.cursor/mcp.json` 파일에 아래 내용을 추가합니다.

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

이후 Cursor를 재시작하면 AI 어시스턴트에서 도구가 활성화됩니다.

---

## Claude Desktop에 MCP 등록

`~/Library/Application Support/Claude/claude_desktop_config.json` 파일에 아래 내용을 추가합니다.

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

## 사용 예시

### recommend_public_apis_for_idea

아이디어 텍스트를 입력하면 관련 공공 API를 추천해줍니다.

**요청 파라미터**


| 파라미터                | 타입      | 필수  | 설명                               |
| ------------------- | ------- | --- | -------------------------------- |
| `ideaText`          | string  | ✅   | 아이디어 설명 (자연어)                    |
| `apiOnly`           | boolean | ❌   | true면 OpenAPI 타입만 반환 (기본: false) |
| `realtimePreferred` | boolean | ❌   | true면 실시간 데이터 우선 (기본: false)     |
| `domainHint`        | string  | ❌   | 도메인 힌트 (예: "교통", "환경")           |
| `limit`             | number  | ❌   | 최대 추천 수 (기본: 5)                  |


**예시 요청**

```
지역 축제 알림 앱을 만들려고 해. 관련 공공 API 추천해줘.
```

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
      "score": 70,
      "reason": "'축제', '행사', '문화행사'와(과) 관련됩니다. OpenAPI 형태로 직접 호출 가능합니다.",
      "detailUrl": "https://www.data.go.kr/data/15006969/openapi.do"
    }
  ]
}
```

---

### search_public_datasets

키워드로 공공데이터를 직접 검색합니다.

**요청 파라미터**


| 파라미터    | 타입     | 필수  | 설명             |
| ------- | ------ | --- | -------------- |
| `query` | string | ✅   | 검색 키워드         |
| `page`  | number | ❌   | 페이지 번호 (기본: 1) |
| `limit` | number | ❌   | 결과 수 (기본: 10)  |


---

### refine_recommendations

이전 추천 결과를 필터 조건으로 재정렬합니다.

**요청 파라미터**


| 파라미터                | 타입      | 필수  | 설명            |
| ------------------- | ------- | --- | ------------- |
| `previousResults`   | array   | ✅   | 이전 추천 결과 배열   |
| `apiOnly`           | boolean | ❌   | OpenAPI만 필터링  |
| `realtimePreferred` | boolean | ❌   | 실시간 데이터 우선    |
| `providerIncludes`  | string  | ❌   | 제공기관 이름 포함 필터 |


---

## 개발

```bash
# 테스트 실행
pnpm test

# 빌드
pnpm build

# 개발 모드 (변경 시 자동 재빌드)
pnpm dev
```

---

## 기술 스택

- **TypeScript** + **Node.js 18+**
- **@modelcontextprotocol/sdk** — MCP 서버 구현
- **zod** — 입력 스키마 검증
- **vitest** — 단위 테스트
- **pnpm** — 패키지 관리
- **공공데이터포털 검색 서비스** (ID: 15112888) — 데이터 소스

---

## 라이선스

MIT