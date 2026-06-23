/**
 * Minimal Kaiten REST client (read-only) for importing cards. Auth is a personal
 * API key (Bearer); base is `https://<domain>.kaiten.ru/api/latest`. Rate limit
 * is 5 req/s → 429 is backed off. Docs: developers.kaiten.ru.
 */

export type KaitenCard = {
  id: number;
  title: string;
  description?: string | null;
  state: number; // 1-queued, 2-inProgress, 3-done
  archived: boolean;
  condition: number; // 1-live, 2-archived
  board_id: number;
  column_id: number;
  lane_id: number | null;
  owner_id: number | null;
  due_date: string | null;
  external_id: string | null;
  created: string;
  updated: string;
};

export type KaitenBoard = { id: number; title: string };

export type KaitenClientOptions = { domain: string; apiKey: string; signal?: AbortSignal };

const KAITEN_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * Validate + canonicalize a Kaiten cloud account to `<slug>.kaiten.ru`.
 * Accepts "company", "company.kaiten.ru", or a full URL. Returns null for
 * anything that isn't a clean *.kaiten.ru subdomain — this is the SSRF guard:
 * an attacker-controlled domain can't redirect our authenticated requests to
 * an arbitrary host.
 */
export function normalizeKaitenDomain(input: string): string | null {
  let d = (input ?? '').trim().toLowerCase().replace(/^https?:\/\//i, '');
  d = d.replace(/[/?#].*$/, ''); // strip path/query/fragment
  if (d.endsWith('.kaiten.ru')) d = d.slice(0, -'.kaiten.ru'.length);
  if (!KAITEN_SLUG_RE.test(d)) return null;
  return `${d}.kaiten.ru`;
}

/** Canonical API base for a Kaiten cloud account. Throws on an invalid domain. */
export function kaitenBaseUrl(domain: string): string {
  const host = normalizeKaitenDomain(domain);
  if (!host) throw new Error(`invalid kaiten domain: ${domain}`);
  return `https://${host}/api/latest`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Parse a Retry-After header (delta-seconds or HTTP-date) into milliseconds, or null. */
function parseRetryAfter(value: string): number | null {
  const secs = Number(value.trim());
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const when = Date.parse(value);
  return Number.isNaN(when) ? null : Math.max(0, when - Date.now());
}

export class KaitenClient {
  private base: string;
  private apiKey: string;
  private signal?: AbortSignal;

  constructor(opts: KaitenClientOptions) {
    this.base = kaitenBaseUrl(opts.domain);
    this.apiKey = opts.apiKey;
    this.signal = opts.signal;
  }

  private async request<T>(path: string): Promise<T> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const res = await fetch(`${this.base}${path}`, {
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        signal: this.signal,
      });
      if (res.status === 429 || res.status === 503) {
        // Honor Retry-After (seconds or HTTP-date) when present; else exponential backoff.
        const ra = res.headers.get('retry-after');
        const raMs = ra ? parseRetryAfter(ra) : null;
        const delay = raMs ?? 1200 * 2 ** attempt + Math.floor(Math.random() * 300);
        await sleep(Math.min(delay, 60_000));
        continue;
      }
      if (!res.ok) {
        let body = '';
        try {
          body = (await res.text()).slice(0, 200);
        } catch {
          /* ignore */
        }
        throw new Error(`kaiten ${path} → ${res.status} ${body}`);
      }
      return (await res.json()) as T;
    }
    throw new Error(`kaiten ${path} → exhausted retries`);
  }

  /** Validate the token + board access cheaply (fetch one card, same shape as the
   *  import query) so a 401/403 surfaces at connect time, not mid-sync. */
  async validate(boardId: number): Promise<void> {
    await this.request<KaitenCard[]>(`/cards?board_id=${boardId}&limit=1&additional_card_fields=description`);
  }

  /** Stream a board's live cards page by page (description included). Terminates
   *  naturally on a short/empty page; the high offset bound is only an
   *  anti-infinite-loop backstop for a misbehaving API. */
  async *listCardsPaged(opts: { boardId?: number; spaceId?: number; condition?: number }): AsyncGenerator<KaitenCard[]> {
    const limit = 100;
    for (let offset = 0; offset < 5_000_000; offset += limit) {
      if (this.signal?.aborted) return;
      const qs = new URLSearchParams({ limit: String(limit), offset: String(offset), additional_card_fields: 'description' });
      if (opts.boardId) qs.set('board_id', String(opts.boardId));
      if (opts.spaceId) qs.set('space_id', String(opts.spaceId));
      qs.set('condition', String(opts.condition ?? 1)); // 1 = on board (live)
      const page = await this.request<KaitenCard[]>(`/cards?${qs.toString()}`);
      if (page.length === 0) return;
      yield page;
      if (page.length < limit) return;
    }
  }

  async listBoards(spaceId: number): Promise<KaitenBoard[]> {
    return this.request<KaitenBoard[]>(`/spaces/${spaceId}/boards`);
  }
}
