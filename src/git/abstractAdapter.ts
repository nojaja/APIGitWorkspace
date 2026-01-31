// Shared abstractions and helpers for Git adapters
export type FetchWithRetryFunction = (_input: RequestInfo, _init: RequestInit, _attempts?: number, _baseDelay?: number) => Promise<Response>

const RETRY_AFTER_HEADER = 'Retry-After'
const RETRY_AFTER_HEADER_LOWER = 'retry-after'

/**
 * Simple logger interface for dependency injection.
 * If a caller injects an object matching this interface, the adapter
 * will forward debug/info/warn/error messages to it. If no logger is
 * provided, no logging will be performed by the adapter.
 */
export interface Logger {
  debug: (..._messages: any[]) => void
  info: (..._messages: any[]) => void
  warn: (..._messages: any[]) => void
  error: (..._messages: any[]) => void
}
/**
 * Compute SHA-1 of string content using Web Crypto
 * @param content The input string
 * @returns Promise resolving to hex-encoded SHA-1
 */
export async function shaOf(content: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(content)
  const buf = await crypto.subtle.digest('SHA-1', data)
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Determine whether an HTTP status should be considered retryable
 * @param status HTTP status code
 * @returns true if retryable (5xx or 429)
 */
export function classifyStatus(status: number): boolean {
  return status >= 500 || status === 429
}

/**
 * Calculate delay before retrying based on response or exponential backoff
 * @param response Response or null when not available
 * @param index Attempt index (0-based)
 * @param baseDelay Base delay in ms
 * @returns delay in milliseconds
 */
export function getDelayForResponse(response: Response | null, index: number, baseDelay: number): number {
  if (!response) return baseDelay * Math.pow(2, index) + Math.random() * 100
  try {
    const hdrs: any = (response as any).headers
    let retryAfter
    if (hdrs && typeof hdrs.get === 'function') {
      retryAfter = hdrs.get(RETRY_AFTER_HEADER) || hdrs.get(RETRY_AFTER_HEADER_LOWER)
    } else if (hdrs && typeof hdrs[RETRY_AFTER_HEADER] !== 'undefined') {
      retryAfter = hdrs[RETRY_AFTER_HEADER] || hdrs[RETRY_AFTER_HEADER_LOWER]
    }
    return retryAfter ? Number(retryAfter) * 1000 : baseDelay * Math.pow(2, index) + Math.random() * 100
  } catch (normalizeError) {
    return baseDelay * Math.pow(2, index) + Math.random() * 100
  }
}

/**
 * Process HTTP response and throw on non-ok. If retryable, delay before throwing.
 * @param response Fetch Response
 * @param index Attempt index
 * @param baseDelay Base delay in ms
 * @returns Promise resolving to the response when ok
 */
export async function processResponseWithDelay(response: Response, index: number, baseDelay: number): Promise<Response> {
  if (response.ok) return response
  if (classifyStatus(response.status)) {
    await new Promise((r) => setTimeout(r, getDelayForResponse(response, index, baseDelay)))
    throw new RetryableError(`Retryable HTTP ${response.status}`)
  }
  const txt = await response.text().catch(() => '')
  throw new NonRetryableError(`HTTP ${response.status}: ${txt}`)
}

/**
 * Perform fetch with retry/backoff logic
 * @param input RequestInfo
 * @param init RequestInit
 * @param attempts number of attempts
 * @param baseDelay base delay in ms
 * @returns Promise resolving to Response
 */
export async function fetchWithRetry(input: RequestInfo, init: RequestInit, attempts = 4, baseDelay = 300): Promise<Response> {
  let lastError: any
  for (let attemptIndex = 0; attemptIndex < attempts; attemptIndex++) {
    try {
      const response = await fetch(input, init)
      return await processResponseWithDelay(response, attemptIndex, baseDelay)
    } catch (error) {
      lastError = error
      await new Promise((r) => setTimeout(r, getDelayForResponse(null, attemptIndex, baseDelay)))
    }
  }
  // If lastError is a known adapter error, rethrow it to preserve semantics
  if (lastError instanceof RetryableError || lastError instanceof NonRetryableError) throw lastError
  // For unknown errors, wrap as RetryableError to indicate exhausted retries
  if (lastError instanceof Error) throw new RetryableError(lastError.message)
  throw new RetryableError(String(lastError))
}

// Standard error types for adapters to share
/**
 * Error indicating the operation is retryable and may succeed on later attempts.
 */
export class RetryableError extends Error {}

/**
 * Error indicating the operation failed in a non-retryable way.
 */
export class NonRetryableError extends Error {}

/**
 * Map items with limited concurrency
 * @template T,R
 * @param items Array of items to map
 * @param mapper Async mapper function
 * @param concurrency concurrency limit
 * @returns Promise resolving to array of mapped results
 */
export function mapWithConcurrency<T, R>(items: T[], mapper: (_t: T) => Promise<R>, concurrency = 5): Promise<R[]> {
  const results: R[] = []
  let index = 0
  const runners: Promise<void>[] = []
  /**
   * Worker that consumes items and writes results
   * @returns Promise<void>
   */
  const run = async () => {
    while (index < items.length) {
      const index_ = index++
      if (index_ >= items.length) break
      const r = await mapper(items[index_])
      results[index_] = r
    }
  }
  for (let runnerIndex = 0; runnerIndex < Math.min(concurrency, items.length); runnerIndex++) runners.push(run())
  return Promise.all(runners).then(() => results)
}

/**
 * Abstract base class providing shared utilities for Git adapters
 */
export abstract class AbstractGitAdapter {
  protected baseUrl = ''
  protected headers: Record<string, string> = {}
  protected options: any = {}
  protected logger?: Logger
  protected maxRetries = 4
  protected baseBackoff = 300

  /**
   * Construct base adapter
   * @param options adapter options
   */
  constructor(options?: any) {
    this.options = options || {}
    // Allow optional logger injection via options.logger
    if (options && options.logger) this.logger = options.logger as Logger
  }

  /**
   * Delegate to shared shaOf implementation
   * @param content input string
   * @returns hex sha1
   */
  protected async shaOf(content: string): Promise<string> {
    return shaOf(content)
  }

  /**
   * Replace or set the logger at runtime.
   * Use this if DI happens after construction.
   * @param logger optional logger instance to set (or undefined to clear)
   * @returns void
   */
  public setLogger(logger: Logger | undefined) {
    this.logger = logger
  }

  // Internal helpers to forward logs only when a logger is injected
  /**
   * Log debug messages when a logger is present.
   * @param _messages messages to log (unused when no logger)
   */
  protected logDebug(..._messages: any[]) {
    if (this.logger && typeof this.logger.debug === 'function') {
      try {
        this.logger.debug(..._messages)
      } catch (loggingError) {
        // Logging errors must not affect adapter behavior; ignore safely
      }
    }
  }

  /**
   * Log an informational message if a logger is present.
   * @param args items to log
   */
  protected logInfo(..._messages: any[]) {
    if (this.logger && typeof this.logger.info === 'function') {
      try {
        this.logger.info(..._messages)
      } catch (loggingError) {
        // ignore logging failures
      }
    }
  }

  /**
   * Log a warning message if a logger is present.
   * @param args items to log
   */
  protected logWarn(..._messages: any[]) {
    if (this.logger && typeof this.logger.warn === 'function') {
      try {
        this.logger.warn(..._messages)
      } catch (loggingError) {
        // ignore logging failures
      }
    }
  }

  /**
   * Log an error message if a logger is present.
   * @param args items to log
   */
  protected logError(..._messages: any[]) {
    if (this.logger && typeof this.logger.error === 'function') {
      try {
        this.logger.error(..._messages)
      } catch (loggingError) {
        // ignore logging failures
      }
    }
  }

  /**
   * Proxy to shared fetchWithRetry implementation
   * @param input RequestInfo
   * @param init RequestInit
   * @param attempts retry attempts
   * @param baseDelay base delay ms
   * @returns Promise resolving to Response
   */
  /**
   * Normalize different header-like shapes into a plain object.
   * @param headerLike headers in Headers, array, or plain object form
   * @returns plain header map
   */
  private normalizeHeaders(headerLike: any): Record<string, any> {
    const out: Record<string, any> = {}
    try {
      if (!headerLike) return out
      if (typeof (headerLike as any).forEach === 'function') {
        (headerLike as any).forEach((v: any, k: any) => { out[k] = v })
        return out
      }
      if (Array.isArray(headerLike)) {
        for (const [k, v] of headerLike as any) out[k] = v
        return out
      }
      if (typeof headerLike === 'object') {
        Object.assign(out, headerLike)
      }
    } catch (normalizeError) {
      // ignore normalization errors
    }
    return out
  }

  /**
   * Format a fetch request into a minimal object suitable for logging.
   * @returns formatted request log object
   */
  private formatRequestForLog(input: RequestInfo, init: RequestInit | undefined, attempts: number, baseDelay: number) {
    const requestUrl = typeof input === 'string' ? input : (input as any)?.url || String(input)
    const requestMethod = (init && (init as any).method) || 'GET'
    const requestHeaders = this.normalizeHeaders((init && (init as any).headers) || {})
    const bodyPreview = init && (init as any).body ? (typeof (init as any).body === 'string' ? (init as any).body.slice(0, 200) : '<non-string>') : undefined
    return { url: requestUrl, method: requestMethod, headers: requestHeaders, bodyPreview, attempts, baseDelay }
  }

  /**
   * Format a fetch Response into a minimal object suitable for logging.
   * @returns formatted response log object
   */
  private async formatResponseForLog(response: Response) {
    const respHdrs = this.normalizeHeaders(response && (response as any).headers)
    let bodyPreview: string | undefined = undefined
    try {
      if (response && typeof (response as any).clone === 'function') {
        const clone = (response as any).clone()
        if (clone && typeof clone.text === 'function') {
          const txt = await clone.text().catch(() => undefined)
          if (typeof txt === 'string') bodyPreview = txt.slice(0, 500)
        }
      }
    } catch (bodyReadError) {
      // ignore body read errors
    }
    return { status: response.status, statusText: response.statusText, headers: respHdrs, bodyPreview }
  }

  /**
   * Proxy to shared `fetchWithRetry` implementation while emitting
   * minimal request/response logs for debugging and test inspection.
   * @param input fetch input
   * @param init fetch init
   * @param attempts retry attempts
   * @param baseDelay base delay ms
   * @returns Promise resolving to Response
   */
  protected async fetchWithRetry(input: RequestInfo, init: RequestInit, attempts = 4, baseDelay = 300) {
    try {
      const requestLog = this.formatRequestForLog(input, init, attempts, baseDelay)
      this.logDebug({ fetchRequest: requestLog })
    } catch (formatError) {
      // best-effort logging
    }

    try {
      const response = await fetchWithRetry(input, init, attempts, baseDelay)
      try {
        const responseLog = await this.formatResponseForLog(response)
        this.logDebug({ fetchResponse: responseLog })
      } catch (formatError) {
        // ignore logging failures
      }
      return response
    } catch (fetchError) {
      try {
        this.logDebug({ fetchError: String(fetchError) })
      } catch (loggingError) {
        // ignore
      }
      throw fetchError
    }
  }

  /**
   * Determine if a status code is retryable
   * @param status HTTP status code
   * @returns boolean
   */
  protected isRetryableStatus(status: number) {
    return classifyStatus(status)
  }

  /**
   * Compute backoff milliseconds for attempt
   * @param attempt attempt number (1..)
   * @returns milliseconds to wait
   */
  protected backoffMs(attempt: number) {
    const base = this.baseBackoff * Math.pow(2, attempt - 1)
    const jitter = Math.floor(Math.random() * base * 0.3)
    return base + jitter
  }

  /**
   * Delegate to shared mapWithConcurrency implementation
   * @template T,R
   * @param items items to map
   * @param mapper async mapper
   * @param concurrency concurrency limit
   * @returns Promise resolving to mapped results
   */
  /**
   * Map items with limited concurrency by delegating to the shared helper.
   * @template T,R
   * @param items items to map
   * @param mapper async mapper
   * @param concurrency concurrency limit
   * @returns Promise resolving to mapped results
   */
  protected mapWithConcurrency<T, R>(items: T[], mapper: (_t: T) => Promise<R>, concurrency = 5) {
    return mapWithConcurrency(items, mapper, concurrency)
  }
}

export default AbstractGitAdapter
