/** Injectable fetch, so tests never touch the network. */
export type FetchLike = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

export interface HttpOptions {
  fetch?: FetchLike;
  /** Injectable sleep, so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Retries after an HTTP 429 before giving up. Default 3. */
  maxRetries?: number;
  /** Wait when a 429 has no usable Retry-After header. Lichess docs: "waiting one minute". */
  defaultBackoffMs?: number;
  /** Per-request timeout (headers and body). Default 30 s. */
  timeoutMs?: number;
  /** Maximum response body size in bytes. Default 25 MB. */
  maxBodyBytes?: number;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_BODY_BYTES = 25_000_000;
/** Games requested when the caller passes no `max`. */
export const DEFAULT_MAX_GAMES = 200;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function retryAfterMs(res: Response): number | undefined {
  const raw = res.headers.get("retry-after");
  if (!raw) return undefined;
  const sec = Number(raw);
  return Number.isFinite(sec) && sec >= 0 ? sec * 1000 : undefined;
}

/**
 * GET a URL and return the response, waiting and retrying on HTTP 429.
 * Callers must issue requests one at a time (both providers ask for that).
 */
export async function getWithBackoff(
  url: string,
  headers: Record<string, string>,
  opts: HttpOptions = {},
): Promise<Response> {
  const doFetch: FetchLike = opts.fetch ?? ((u, init) => fetch(u, init));
  const sleep = opts.sleep ?? defaultSleep;
  const maxRetries = opts.maxRetries ?? 3;
  const fallback = opts.defaultBackoffMs ?? 60_000;

  for (let attempt = 0; ; attempt++) {
    const res = await doFetch(url, { headers, signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
    if (res.status === 429) {
      if (attempt >= maxRetries) {
        throw new HttpError(429, url, `Rate limited (HTTP 429) after ${attempt + 1} attempts: ${url}`);
      }
      // Wait at least the server hint; grow on repeated 429s.
      await sleep((retryAfterMs(res) ?? fallback) * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new HttpError(res.status, url, `HTTP ${res.status} for ${url}`);
    return res;
  }
}

/** Read a response body as text, failing once it exceeds the byte cap (checks Content-Length, then streams). */
export async function readTextCapped(res: Response, maxBytes: number = DEFAULT_MAX_BODY_BYTES): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(res.status, res.url, `Response too large (${declared} > ${maxBytes} bytes).`);
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new HttpError(res.status, res.url, `Response too large (over ${maxBytes} bytes).`);
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}
