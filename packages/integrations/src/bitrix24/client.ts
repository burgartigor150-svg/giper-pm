/**
 * Tiny Bitrix24 REST client for incoming-webhook URLs.
 *
 * Why not OAuth: the user pasted an inbound-webhook URL with full scopes,
 * which is the simplest auth path for cloud Bitrix24 — no tokens to refresh,
 * just append the method name to the base URL and POST/GET parameters.
 *
 * Throttling: cloud Bitrix24 caps a single inbound webhook at ~2 RPS. We
 * pace requests to ~3 per second with a tiny in-process queue; if the
 * server still answers QUERY_LIMIT_EXCEEDED we back off and retry.
 */

export type Bitrix24ClientOptions = {
  /** Inbound-webhook URL ending in trailing slash, e.g.
   *  https://giper.bitrix24.ru/rest/1282/is01dtztz8cii4wn/
   */
  webhookUrl: string;
  /** Floor between requests, default 350ms. */
  minIntervalMs?: number;
  /** AbortSignal to cancel a long pagination run. */
  signal?: AbortSignal;
};

export type Bitrix24Response<T> = {
  result: T;
  next?: number;
  total?: number;
  time?: { duration: number };
  error?: string;
  error_description?: string;
};

export class Bitrix24Error extends Error {
  constructor(
    public readonly method: string,
    public readonly status: number,
    public readonly bitrixError: string | undefined,
    public readonly description: string | undefined,
  ) {
    super(
      `bitrix24 ${method} failed: ${status} ${bitrixError ?? ''} ${description ?? ''}`.trim(),
    );
    this.name = 'Bitrix24Error';
  }
}

export class Bitrix24Client {
  private readonly base: string;
  private readonly minIntervalMs: number;
  private readonly signal?: AbortSignal;
  private nextSlot = 0;

  constructor(opts: Bitrix24ClientOptions) {
    if (!opts.webhookUrl) throw new Error('webhookUrl required');
    this.base = opts.webhookUrl.endsWith('/') ? opts.webhookUrl : opts.webhookUrl + '/';
    this.minIntervalMs = opts.minIntervalMs ?? 350;
    this.signal = opts.signal;
  }

  /** Single REST call, throttled. */
  async call<T>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Bitrix24Response<T>> {
    await this.gate();
    const url = this.base + method;
    let attempt = 0;
    // Up to 3 retries on rate-limit / 5xx.
    while (true) {
      attempt++;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal: this.signal,
      });
      const text = await res.text();
      let body: Bitrix24Response<T>;
      try {
        body = JSON.parse(text);
      } catch {
        if (res.status >= 500 && attempt < 3) {
          await sleep(500 * attempt);
          continue;
        }
        throw new Bitrix24Error(method, res.status, 'PARSE', text.slice(0, 200));
      }
      if (body.error) {
        if (body.error === 'QUERY_LIMIT_EXCEEDED' && attempt < 5) {
          await sleep(800 * attempt);
          continue;
        }
        throw new Bitrix24Error(method, res.status, body.error, body.error_description);
      }
      if (!res.ok) {
        if (res.status >= 500 && attempt < 3) {
          await sleep(500 * attempt);
          continue;
        }
        throw new Bitrix24Error(method, res.status, 'HTTP', text.slice(0, 200));
      }
      return body;
    }
  }

  /**
   * Iterate over a paginated method using `start=N` cursor.
   *
   * Two response shapes happen in the wild:
   *   - Legacy methods: `result: T[]` directly (e.g. `user.get`,
   *     `sonet_group.get`).
   *   - Newer methods: `result: { tasks: T[] }` (e.g. `tasks.task.list`)
   *     where `tasks` is the actual collection key.
   *
   * Caller passes the collection key for new-style methods via
   * `collectionKey`. Default treats `result` itself as the array.
   */
  async *paginate<T>(
    method: string,
    params: Record<string, unknown> = {},
    collectionKey?: string,
  ): AsyncGenerator<T[], void, void> {
    let start = 0;
    while (true) {
      const page = await this.call<unknown>(method, { ...params, start });
      const raw = page.result as unknown;
      let items: T[];
      if (collectionKey && raw && typeof raw === 'object') {
        const v = (raw as Record<string, unknown>)[collectionKey];
        items = Array.isArray(v) ? (v as T[]) : [];
      } else {
        items = Array.isArray(raw) ? (raw as T[]) : [];
      }
      yield items;
      if (typeof page.next !== 'number') return;
      start = page.next;
    }
  }

  /** Pulls all pages into a single array. Use only when you know the size is sane. */
  async all<T>(
    method: string,
    params: Record<string, unknown> = {},
    collectionKey?: string,
  ): Promise<T[]> {
    const out: T[] = [];
    for await (const page of this.paginate<T>(method, params, collectionKey)) {
      out.push(...page);
    }
    return out;
  }

  private async gate(): Promise<void> {
    const now = Date.now();
    const wait = Math.max(0, this.nextSlot - now);
    this.nextSlot = Math.max(now, this.nextSlot) + this.minIntervalMs;
    if (wait > 0) await sleep(wait);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
