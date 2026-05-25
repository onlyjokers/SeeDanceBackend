export interface RetryOptions {
  maxRetries: number;
  delayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (event: RetryEvent) => void | Promise<void>;
}

export interface RetryEvent {
  attempt: number;
  maxRetries: number;
  error: unknown;
  message: string;
}

export async function retryOperation<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      attempt += 1;
      if (attempt > options.maxRetries || options.shouldRetry?.(error) === false) throw error;
      const message = errorMessage(error);
      await options.onRetry?.({ attempt, maxRetries: options.maxRetries, error, message });
      if (options.delayMs && options.delayMs > 0) await sleep(options.delayMs);
    }
  }
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function isLikelyNetworkError(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return [
    "fetch failed",
    "network",
    "timeout",
    "timed out",
    "econnreset",
    "econnrefused",
    "etimedout",
    "socket",
    "terminated"
  ].some((pattern) => message.includes(pattern));
}

export function isUnknownSubmissionError(error: unknown) {
  return isLikelyNetworkError(error);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
