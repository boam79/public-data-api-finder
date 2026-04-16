/**
 * 지수 백오프 재시도 유틸리티.
 *
 * [수정] 네트워크 오류뿐 아니라 HTTP 5xx 응답도 재시도한다.
 *       각 시도마다 AbortController로 타임아웃을 걸어 무한 대기를 방지한다.
 *
 * 재시도 전략:
 *   - 시도 1: 즉시
 *   - 시도 2: baseDelayMs (기본 500ms) 후
 *   - 시도 3: baseDelayMs * 2 후
 *   ...
 *
 * 영구 오류(인증 키 문제 등)는 즉시 throw한다.
 */

import { logger } from "./logger.js";

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  /** 요청당 타임아웃 (ms). 기본 8000ms */
  timeoutMs?: number;
  /** 재시도해야 할 오류인지 판별. false 반환 시 즉시 throw */
  retryOn?: (err: unknown, response?: Response) => boolean;
}

/** 재시도 불필요한 영구 오류 패턴 */
const PERMANENT_ERROR_PATTERNS = [
  "등록되지 않은 인증키",
  "유효하지 않은 인증키",
  "미신청",
  "API 미신청",
];

function isPermanentError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return PERMANENT_ERROR_PATTERNS.some((p) => msg.includes(p));
}

/** HTTP 4xx는 영구 오류, 5xx는 재시도 가능 */
function defaultRetryOn(err: unknown, response?: Response): boolean {
  if (isPermanentError(err)) return false;
  if (response) {
    if (response.status >= 400 && response.status < 500) return false; // 4xx 영구 오류
    if (response.status >= 500) return true; // 5xx 재시도
  }
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fetch 호출을 타임아웃 + 재시도로 감싼다.
 * HTTP 5xx 응답도 재시도 대상으로 처리한다.
 *
 * fetchFn을 주입하면 테스트에서 mock fetch를 사용할 수 있다.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: RetryOptions & { fetchFn?: typeof fetch } = {}
): Promise<Response> {
  const {
    maxAttempts = 3,
    baseDelayMs = 500,
    timeoutMs = 8000,
    retryOn = defaultRetryOn,
    fetchFn = fetch,
  } = options;

  let lastError: unknown;
  let lastResponse: Response | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetchFn(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      // HTTP 5xx → 재시도 대상으로 처리
      if (res.status >= 500 && retryOn(undefined, res)) {
        lastResponse = res;
        if (attempt < maxAttempts) {
          const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
          logger.warn(`HTTP ${res.status} 재시도 ${attempt}/${maxAttempts} — ${delayMs}ms 대기`, {});
          await sleep(delayMs);
          continue;
        }
        return res; // 최종 시도에서도 5xx면 그대로 반환 (상위에서 오류 처리)
      }

      return res;
    } catch (err) {
      clearTimeout(timer);

      const isTimeout =
        err instanceof Error &&
        (err.name === "AbortError" || err.message.includes("aborted"));

      lastError = isTimeout
        ? new Error(`요청 타임아웃 (${timeoutMs}ms 초과)`)
        : err;

      if (!retryOn(lastError)) throw lastError;

      if (attempt < maxAttempts) {
        const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
        logger.warn(
          `네트워크 오류 재시도 ${attempt}/${maxAttempts} — ${delayMs}ms 대기`,
          { error: lastError instanceof Error ? lastError.message : String(lastError) }
        );
        await sleep(delayMs);
      }
    }
  }

  throw lastError ?? new Error("알 수 없는 요청 오류");
}

/** 일반 비동기 함수 재시도 래퍼 (fetch 외 용도) */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Omit<RetryOptions, "timeoutMs"> = {}
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 500, retryOn = defaultRetryOn } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!retryOn(err)) throw err;

      if (attempt < maxAttempts) {
        const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
        logger.warn(`재시도 ${attempt}/${maxAttempts} — ${delayMs}ms 대기`, {
          error: err instanceof Error ? err.message : String(err),
        });
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}
