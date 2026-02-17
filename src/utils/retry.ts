/**
 * Retry wrapper with exponential backoff.
 * Handles Twitter API 429 (rate limit) and transient errors.
 */
export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** HTTP status codes that should trigger a retry */
  retryableStatuses?: number[];
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 60_000,
  retryableStatuses: [429, 500, 502, 503, 504],
};

/**
 * Execute a function with exponential backoff retry on failure.
 * For 429 responses, respects the Retry-After header if present.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  opts: Partial<RetryOptions> = {}
): Promise<T> {
  const options = { ...DEFAULT_OPTIONS, ...opts };
  let lastError: unknown;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;

      // Check if this is a retryable error
      const statusCode = err?.code ?? err?.status ?? err?.data?.status ?? extractStatusCode(err);
      const isRetryable =
        options.retryableStatuses?.includes(statusCode) ||
        isTransientError(err);

      if (!isRetryable || attempt === options.maxRetries) {
        throw err;
      }

      // Calculate delay — respect Retry-After header for 429s
      let delayMs: number;
      const retryAfter = extractRetryAfter(err);
      if (retryAfter) {
        delayMs = retryAfter * 1000;
      } else {
        // Exponential backoff with jitter
        delayMs = Math.min(
          options.maxDelayMs,
          options.baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000
        );
      }

      console.warn(
        `[Retry] ${label} failed (attempt ${attempt + 1}/${options.maxRetries + 1}), ` +
        `status=${statusCode || "unknown"}, retrying in ${Math.round(delayMs / 1000)}s...`
      );

      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * Try to extract an HTTP status code from various error shapes.
 */
function extractStatusCode(err: any): number | undefined {
  if (!err) return undefined;

  // twitter-api-v2 error shape
  if (err.rateLimitError) return 429;
  if (err.rateLimit?.remaining === 0) return 429;

  // Generic error message parsing
  const msg = String(err.message || err);
  const match = msg.match(/\b(429|500|502|503|504)\b/);
  return match ? Number(match[1]) : undefined;
}

/**
 * Try to extract Retry-After value (in seconds) from error.
 */
function extractRetryAfter(err: any): number | undefined {
  // twitter-api-v2 includes rate limit reset info
  if (err.rateLimit?.reset) {
    const resetTime = err.rateLimit.reset * 1000; // convert to ms
    const waitMs = resetTime - Date.now();
    if (waitMs > 0) {
      return Math.ceil(waitMs / 1000);
    }
  }

  // Generic Retry-After header
  const retryAfter = err.headers?.get?.("retry-after") ?? err.retryAfter;
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (!isNaN(seconds)) return seconds;
  }

  return undefined;
}

/**
 * Detect transient network/connection errors.
 */
function isTransientError(err: any): boolean {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up") ||
    msg.includes("network error") ||
    msg.includes("fetch failed") ||
    msg.includes("abort") ||
    err?.code === "ECONNRESET" ||
    err?.code === "ECONNREFUSED" ||
    err?.code === "ETIMEDOUT"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
