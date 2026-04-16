/**
 * 지수 백오프 재시도 유틸리티.
 *
 * 네트워크/일시 오류 시 최대 maxAttempts회까지 재시도하며,
 * 대기 시간은 baseDelayMs * 2^(시도 횟수) 로 증가한다.
 *
 * retryOn 함수가 false를 반환하는 오류(예: 인증 오류)는 즉시 rethrow한다.
 */

import { logger } from "./logger.js";

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  /** 재시도해야 할 오류인지 판별. false 반환 시 즉시 throw */
  retryOn?: (err: unknown) => boolean;
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

function defaultRetryOn(err: unknown): boolean {
  return !isPermanentError(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 500,
    retryOn = defaultRetryOn,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (!retryOn(err)) {
        throw err;
      }

      if (attempt < maxAttempts) {
        const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
        logger.warn(`재시도 ${attempt}/${maxAttempts - 1} — ${delayMs}ms 후 재시도`, {
          error: err instanceof Error ? err.message : String(err),
        });
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}
