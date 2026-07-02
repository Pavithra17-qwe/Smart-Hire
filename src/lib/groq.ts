// lib/groq.ts
//
// Shared Groq client. Wraps the same chat-completions call every route was
// already making, and adds:
//   - exponential-backoff retry on 429 (rate limit)
//   - token / prompt-size / response-size logging
//   - a user-friendly error message helper (never expose raw API errors)
//
// This does NOT change any prompts, business logic, or response shapes —
// it is a drop-in replacement for a raw `fetch(...)` call to Groq.

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export interface GroqCallOptions {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
  maxRetries?: number;   // default 3
  baseDelayMs?: number;  // default 2000
  label?: string;        // for logs, e.g. "questions:generate" or "scoring:evaluate"
}

export interface GroqCallResult {
  text: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  retriedCount: number;
}

export class GroqRateLimitError extends Error {
  retryAfterSeconds?: number;
  constructor(message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'GroqRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function parseRetryAfterSeconds(errBody: any, headerValue: string | null): number | undefined {
  // Groq embeds messages like "Please try again in 26m47.04s" in 429 bodies.
  const msg: string | undefined = errBody?.error?.message;
  if (msg) {
    const match = msg.match(/try again in\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:([\d.]+)s)?/i);
    if (match && (match[1] || match[2] || match[3])) {
      const hours = parseFloat(match[1] || '0');
      const minutes = parseFloat(match[2] || '0');
      const seconds = parseFloat(match[3] || '0');
      const total = hours * 3600 + minutes * 60 + seconds;
      if (total > 0) return total;
    }
  }
  if (headerValue) {
    const n = parseFloat(headerValue);
    if (!isNaN(n)) return n;
  }
  return undefined;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls Groq's chat completions endpoint with exponential-backoff retry on
 * 429s, and logs token usage / prompt+response sizes.
 *
 * Throws GroqRateLimitError when:
 *   - retries are exhausted on a transient 429, or
 *   - the API reports a wait longer than ~20s (a daily-quota-style limit,
 *     where retrying inside the same request can't help — fail fast instead
 *     of blocking the request for 26 minutes).
 *
 * Callers should catch GroqRateLimitError and use userFriendlyRateLimitMessage()
 * rather than surfacing err.message to the end user.
 */
export async function callGroqWithRetry(opts: GroqCallOptions): Promise<GroqCallResult> {
  const {
    model,
    system,
    user,
    maxTokens,
    temperature = 0.3,
    maxRetries = 3,
    baseDelayMs = 2000,
    label = 'groq',
  } = opts;

  const promptChars = system.length + user.length;
  console.log(
    `[groq][${label}] Prompt size: ~${promptChars} chars (system=${system.length}, user=${user.length}) | max_tokens requested: ${maxTokens}`
  );

  let attempt = 0;
  let lastError: any = null;

  while (attempt <= maxRetries) {
    try {
      const response = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature,
          max_tokens: maxTokens,
        }),
      });

      if (response.status === 429) {
        const errBody = await response.json().catch(() => null);
        const retryAfterHeader = response.headers.get('retry-after');
        const retryAfterSeconds = parseRetryAfterSeconds(errBody, retryAfterHeader);

        console.warn(
          `[groq][${label}] 429 rate limit on attempt ${attempt + 1}/${maxRetries + 1}. ` +
            `Retry-After: ${retryAfterSeconds ?? 'unknown'}s | Message: ${errBody?.error?.message ?? 'n/a'}`
        );

        // Long waits (daily token quota) won't resolve within this request —
        // fail fast with the real reason instead of sleeping for 26 minutes.
        if (retryAfterSeconds !== undefined && retryAfterSeconds >= 20) {
          throw new GroqRateLimitError(errBody?.error?.message || 'Rate limit exceeded', retryAfterSeconds);
        }

        if (attempt === maxRetries) {
          throw new GroqRateLimitError(errBody?.error?.message || 'Rate limit exceeded', retryAfterSeconds);
        }

        const backoff = baseDelayMs * Math.pow(2, attempt);
        const delay = retryAfterSeconds !== undefined ? retryAfterSeconds * 1000 : backoff;
        await sleep(delay);
        attempt++;
        continue;
      }

      if (!response.ok) {
        const errBody = await response.json().catch(() => null);
        throw new Error(`Groq API error ${response.status}: ${errBody?.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content || '';
      const usage = data?.usage;

      console.log(
        `[groq][${label}] Success on attempt ${attempt + 1}/${maxRetries + 1}. ` +
          `Tokens — prompt: ${usage?.prompt_tokens ?? 'n/a'}, completion: ${usage?.completion_tokens ?? 'n/a'}, total: ${usage?.total_tokens ?? 'n/a'} | ` +
          `Response size: ${text.length} chars`
      );

      return { text, usage, retriedCount: attempt };
    } catch (err) {
      if (err instanceof GroqRateLimitError) throw err;
      lastError = err;
      if (attempt === maxRetries) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt);
      console.warn(
        `[groq][${label}] Transient error on attempt ${attempt + 1}, retrying in ${delay}ms:`,
        err instanceof Error ? err.message : err
      );
      await sleep(delay);
      attempt++;
    }
  }

  throw lastError || new Error('Groq call failed after retries');
}

/** User-friendly message for rate-limit failures — never expose raw API errors to end users. */
export function userFriendlyRateLimitMessage(err: unknown): string {
  if (err instanceof GroqRateLimitError) {
    if (err.retryAfterSeconds && err.retryAfterSeconds > 60) {
      const minutes = Math.ceil(err.retryAfterSeconds / 60);
      return `AI service is temporarily rate limited. Please try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
    }
    return 'AI service is temporarily rate limited. Please try again in a few minutes.';
  }
  return 'AI service is temporarily unavailable. Please try again shortly.';
}

/** True if an error is (or wraps) a Groq rate-limit condition — for routes that want to return 429. */
export function isRateLimitError(err: unknown): boolean {
  return err instanceof GroqRateLimitError;
}