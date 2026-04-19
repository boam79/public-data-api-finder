/**
 * 자연어 아이디어 텍스트에서 검색에 유용한 핵심 키워드를 추출한다.
 * LLM 호출 없이 규칙 기반으로 동작하여 토큰을 절약한다.
 */

/** 한국어 불용어 목록 */
const STOP_WORDS = new Set([
  "을", "를", "이", "가", "은", "는", "의", "에", "에서", "으로", "로",
  "와", "과", "도", "만", "부터", "까지", "하고", "이고", "거나", "하는",
  "있는", "없는", "만들고", "만들기", "만들어", "하기", "되는", "되어",
  "싶어", "싶다", "싶은", "주는", "주기", "주고", "해서", "해주는",
  "서비스", "앱", "애플리케이션", "시스템", "플랫폼", "사이트", "웹",
  "개발", "구현", "제작", "위한", "관련", "이용", "활용", "사용",
  "한국", "대한민국", "전국", "맞는", "맞춤", "맞게", "찾아줘", "찾기",
  "알려줘", "보여줘", "추천", "좋은", "좋은데", "정도", "수준", "것",
  "거", "때", "후", "전", "중", "내", "외", "안", "밖", "위", "아래",
]);

/** 도메인 키워드 사전 — 입력 텍스트에 포함되면 관련 검색어를 추가한다 */
const DOMAIN_EXPANSIONS: Record<string, string[]> = {
  // 문화/관광
  축제: ["행사", "문화행사", "지역행사"],
  행사: ["축제", "이벤트", "문화행사"],
  관광: ["여행", "관광지", "관광명소"],
  여행: ["관광", "관광지"],
  // 교통
  버스: ["대중교통", "교통", "노선"],
  지하철: ["대중교통", "교통", "노선"],
  교통: ["버스", "지하철", "도로"],
  주차: ["주차장", "주차정보"],
  // 의료/보건
  병원: ["의료기관", "의료", "진료", "보건"],
  의료: ["병원", "의료기관", "진료"],
  심평원: ["건강보험", "진료비", "의료기관", "의약품"],
  건강보험: ["진료비", "보험급여", "의료기관"],
  진료: ["의료기관", "병원", "진료비"],
  약: ["의약품", "약품", "처방"],
  의약품: ["약", "처방", "약품"],
  감염병: ["코로나", "보건", "역학"],
  코로나: ["감염병", "보건", "백신"],
  // 환경
  날씨: ["기상", "기후", "날씨예보"],
  기상: ["날씨", "기후"],
  환경: ["대기", "수질", "오염"],
  대기: ["환경", "미세먼지", "공기"],
  미세먼지: ["대기", "환경", "공기질"],
  // 부동산/주거
  부동산: ["아파트", "주택", "토지", "매매"],
  아파트: ["부동산", "주택", "매매"],
  // 교육
  학교: ["교육", "학교정보"],
  교육: ["학교", "학원"],
  // 식품
  음식: ["식당", "음식점", "요식업"],
  식당: ["음식점", "요식업", "음식"],
  // 복지/고용
  취업: ["일자리", "고용", "구인"],
  일자리: ["취업", "고용", "구인구직"],
  복지: ["사회복지", "지원서비스", "복지서비스"],
  // 통계
  인구: ["인구통계", "통계"],
  통계: ["인구", "조사"],
  KOSIS: ["통계", "국가통계", "통계청"],
  // 안전
  범죄: ["치안", "경찰", "안전"],
  소방: ["화재", "안전", "재난"],
  재난: ["소방", "안전", "재해"],
  // 조달/공공구매
  나라장터: ["조달", "입찰", "계약", "공공구매"],
  조달: ["나라장터", "입찰", "계약"],
  입찰: ["조달", "나라장터", "계약"],
  // 창업/기업지원
  창업: ["스타트업", "벤처", "중소기업"],
  스타트업: ["창업", "벤처"],
  중소기업: ["창업", "스타트업", "소상공인"],
  // 연구개발
  연구: ["R&D", "과제", "기술"],
  // 금융
  금융: ["은행", "보험", "주식", "투자"],
  부동산등기: ["등기", "부동산", "소유권"],
  // 농업
  농업: ["농산물", "농지", "작물"],
  농산물: ["농업", "식품"],
};

/** 실시간성 관련 키워드 */
const REALTIME_KEYWORDS = new Set([
  "실시간", "현재", "즉시", "바로", "라이브", "live", "현황",
]);

/** 단어 끝에 붙는 한국어 조사/어미를 제거 */
const ENDINGS = [
  "으로부터", "에서부터", "로부터", "으로서", "에서는", "로서는",
  "에서도", "에서는", "에게서", "에게는", "에게도", "에게",
  "으로는", "으로도", "으로만", "로서는",
  "이라는", "이라고", "이라도",
  "에서", "으로", "에도", "에는", "부터", "까지",
  "하고", "이고", "이랑",
  "에서", "에는", "에도",
  "을", "를", "은", "는", "의", "와", "과", "도",
];

function stripEndings(token: string): string {
  let result = token;
  for (const ending of ENDINGS) {
    if (result.endsWith(ending) && result.length > ending.length + 1) {
      result = result.slice(0, result.length - ending.length);
      break;
    }
  }
  return result;
}

/** 텍스트를 공백/특수문자 기준으로 토큰화 */
function tokenize(text: string): string[] {
  return text
    .replace(/[^\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F\w\s]/g, " ")
    .split(/\s+/)
    .map((t) => stripEndings(t.trim()))
    .filter((t) => t.length >= 2);
}

export interface ExtractedKeywords {
  keywords: string[];
  isRealtimeHinted: boolean;
}

/**
 * 아이디어 텍스트에서 핵심 키워드를 추출한다.
 * @param ideaText 사용자 자연어 입력
 * @param domainHint 사용자가 명시한 도메인 힌트 (선택)
 */
export function extractKeywords(
  ideaText: string,
  domainHint?: string
): ExtractedKeywords {
  const tokens = tokenize(ideaText);

  // 불용어 제거
  const filtered = tokens.filter((t) => !STOP_WORDS.has(t));

  // 실시간 힌트 감지
  const isRealtimeHinted = tokens.some((t) => REALTIME_KEYWORDS.has(t));

  // 도메인 확장
  const expanded = new Set<string>(filtered);
  for (const token of filtered) {
    const expansions = DOMAIN_EXPANSIONS[token];
    if (expansions) {
      expansions.forEach((e) => expanded.add(e));
    }
  }

  // 도메인 힌트 추가
  if (domainHint) {
    const hintTokens = tokenize(domainHint).filter(
      (t) => !STOP_WORDS.has(t)
    );
    hintTokens.forEach((t) => {
      expanded.add(t);
      const expansions = DOMAIN_EXPANSIONS[t];
      if (expansions) expansions.slice(0, 2).forEach((e) => expanded.add(e));
    });
  }

  // 중복 제거 후 최대 8개
  const keywords = [...expanded].slice(0, 8);

  return { keywords, isRealtimeHinted };
}
