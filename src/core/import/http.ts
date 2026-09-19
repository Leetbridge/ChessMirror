/** Injectable fetch, so tests never touch the network. */
export type FetchLike = (input: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

export interface HttpOptions {
  fetch?: FetchLike;
  /** Injectable sleep, so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Retries after an HTTP 429 before giving up. Default 3. */
  maxRetries?: number;
  /** Wait when a 429 has no usable Retry-After header. Lichess docs: "waiting one minute". */
  defaultBackoffMs?: number;
}

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
    const res = await doFetch(url, { headers });
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
