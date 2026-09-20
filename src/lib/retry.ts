/**
 * The OpenRouter key backing this project runs on a very thin credit buffer,
 * which rejects a request outright ("would exceed your available credits
 * given your current in-flight requests") whenever too many calls are
 * in-flight at once - a transient capacity error, not a model/pipeline
 * failure. Retry those with backoff instead of counting them against the
 * benchmark's quality metrics.
 */
export async function withRetry<T>(fn: () => Promise<T>, retries = 6, delayMs = 1500): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = (e as Error).message ?? "";
      const transient = /exceed your available credits|rate limit|429/i.test(msg);
      if (!transient || attempt === retries) throw e;
      await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
  throw lastErr;
}
