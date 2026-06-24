/**
 * Minimal TEAMLY REST client for the one-way KB import (cloud app.teamly.ru or a
 * boxed instance). Auth is the OAuth "integration" flow: authorize(code) →
 * access/refresh tokens, refresh() to renew. API calls carry
 * `Authorization: Bearer` + `X-Account-Slug` against the account's clusterDomain.
 *
 * Docs: TEAMLY Академия › Интеграции и внешние API.
 */

export type TeamlyTokens = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number; // unix seconds
  refreshExpiresAt: number;
  clusterDomain: string;
};

export type TeamlyAuthInput = {
  slug: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

/** TEAMLY account slug — a single DNS label. Validated so it can't rewrite the
 * request host (e.g. "evil.com/" → host evil.com) and exfiltrate the secret. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/i;
export function isValidTeamlySlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

function authBase(slug: string): string {
  if (!isValidTeamlySlug(slug)) throw new Error('invalid teamly slug');
  return `https://${slug}.teamly.ru`;
}

function parseTokens(json: Record<string, unknown>, fallbackCluster: string, slug: string): TeamlyTokens {
  // The API spells it "acces_token" in places; accept both.
  const accessToken = String(json.access_token ?? (json as Record<string, unknown>).acces_token ?? '');
  const refreshToken = String(json.refresh_token ?? '');
  let clusterDomain = fallbackCluster;
  const accounts = Array.isArray(json.accounts) ? (json.accounts as Record<string, unknown>[]) : [];
  const acct = accounts.find((a) => a.slug === slug) ?? accounts[0];
  if (acct && typeof acct.clusterDomain === 'string' && acct.clusterDomain) clusterDomain = acct.clusterDomain;
  return {
    accessToken,
    refreshToken,
    accessExpiresAt: Number(json.access_token_expires_at ?? 0),
    refreshExpiresAt: Number(json.refresh_token_expires_at ?? 0),
    clusterDomain,
  };
}

/** Exchange an authorization code for tokens. */
export async function teamlyAuthorize(input: TeamlyAuthInput, code: string): Promise<TeamlyTokens> {
  const res = await fetch(`${authBase(input.slug)}/api/v1/auth/integration/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      client_secret: input.clientSecret,
      code,
    }),
  });
  if (!res.ok) throw new Error(`teamly authorize failed: ${res.status} ${await safeText(res)}`);
  return parseTokens(await res.json(), 'https://app.teamly.ru', input.slug);
}

/** Renew tokens with a refresh token. */
export async function teamlyRefresh(input: Omit<TeamlyAuthInput, 'redirectUri'>, refreshToken: string): Promise<TeamlyTokens> {
  const res = await fetch(`${authBase(input.slug)}/api/v1/auth/integration/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: input.clientId, client_secret: input.clientSecret, refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error(`teamly refresh failed: ${res.status} ${await safeText(res)}`);
  return parseTokens(await res.json(), 'https://app.teamly.ru', input.slug);
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A space «свойство» = a smart-table column. A space with a non-empty
 * schemaProperties (beyond the system title/author/executor/executionDate) is a
 * TEAMLY smart table; its articles are the rows. (Docs: "Умная таблица является
 * пространством. Столбцы — свойства пространства, строки — статьи".)
 */
export type TeamlySchemaProperty = {
  id?: string;
  propertyId?: string;
  name?: string;
  /** text | select | multi-select | number | checkbox | date | url | person | title */
  type?: string;
  /** key the article's row values are stored under (article.properties.properties[code]) */
  code?: string;
  format?: string | null;
  /** select/multi-select variants — shape varies; parsed defensively in the sync. */
  options?: unknown;
  sort?: number | null;
  hide?: boolean;
};

export type TeamlySpace = {
  id: string;
  title: string;
  description: string | null;
  main_article?: { id: string } | null;
  schemaProperties?: TeamlySchemaProperty[];
};
export type TeamlyTreeItem = {
  id: string;
  title: string;
  parentSpaceId: string | null;
  type: 'article' | 'space' | 'inlineDatabaseArticle' | string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  createdBy: string | null;
};
export type TeamlyArticle = {
  id: string;
  title: string;
  icon: string | null;
  archived: boolean;
  is_hidden: boolean;
  created_at: number | null;
  updated_at: number | null;
  editorContentObject: { content: string; versionAt: number } | null;
  author: { id: string; full_name: string | null; external_id: string | null } | null;
  breadcrumbs?: { sourceId: string; sourceType: string; title: string }[];
  /** Smart-table row values, keyed by property `code` (T3). Null for plain articles. */
  properties?: { properties?: Record<string, unknown> | null } | null;
};

export type TeamlyClientOptions = {
  clusterDomain: string;
  slug: string;
  accessToken: string;
  /** Called on 401 to obtain a fresh access token; returns null if unavailable. */
  refresh?: () => Promise<string | null>;
  signal?: AbortSignal;
};

export class TeamlyClient {
  private clusterDomain: string;
  private slug: string;
  private accessToken: string;
  private refresh?: () => Promise<string | null>;
  private signal?: AbortSignal;

  constructor(opts: TeamlyClientOptions) {
    this.clusterDomain = opts.clusterDomain.replace(/\/+$/, '');
    this.slug = opts.slug;
    this.accessToken = opts.accessToken;
    this.refresh = opts.refresh;
    this.signal = opts.signal;
  }

  private async request<T>(path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<T> {
    const url = `${this.clusterDomain}${path}`;
    let refreshed = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      const res = await fetch(url, {
        method: init.method,
        headers: {
          'X-Account-Slug': this.slug,
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: this.signal,
      });
      if (res.status === 401 && this.refresh && !refreshed) {
        const fresh = await this.refresh();
        if (fresh) {
          this.accessToken = fresh;
          refreshed = true;
          continue;
        }
      }
      if (res.status === 429 || res.status === 503) {
        await sleep(1500 * 2 ** attempt + Math.floor(Math.random() * 400));
        continue;
      }
      if (!res.ok) throw new Error(`teamly ${path} → ${res.status} ${await safeText(res)}`);
      return (await res.json()) as T;
    }
    throw new Error(`teamly ${path} → exhausted retries`);
  }

  /**
   * Download a TEAMLY-hosted file referenced by a SAME-ORIGIN relative path from
   * article content (e.g. `/attachments/download/123/x.png`) → bytes, authed with
   * the same bearer + slug as the API. SSRF guard: only relative paths are
   * accepted, so the request always starts at the configured cluster domain — an
   * absolute/external `src` (a CDN image, googleusercontent, …) returns null and
   * is left as-is. Streams with a hard byte cap (decompression-bomb safe).
   */
  async downloadFile(
    path: string,
    opts: { maxBytes?: number; timeoutMs?: number } = {},
  ): Promise<{ bytes: Buffer; contentType: string } | null> {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return null;
    const maxBytes = opts.maxBytes ?? 50 * 1024 * 1024;
    const timeoutMs = opts.timeoutMs ?? 30_000;
    let clusterHost: string;
    try {
      clusterHost = new URL(this.clusterDomain).host.toLowerCase();
    } catch {
      return null;
    }

    // Per-download deadline, combined with the run-level abort signal.
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (this.signal?.aborted) return null;
    this.signal?.addEventListener('abort', onAbort);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let refreshed = false;
      for (let attempt = 0; attempt < 4; attempt++) {
        // controller.signal is the same runtime AbortSignal fetch accepts; the
        // cast bridges the duplicate DOM/node lib declarations.
        const res = await this.fetchFileSameOrigin(
          `${this.clusterDomain}${path}`,
          clusterHost,
          controller.signal as AbortSignal,
        );
        if (!res) return null; // off-origin redirect / too many hops → don't leak the token
        if (res.status === 401 && this.refresh && !refreshed) {
          const fresh = await this.refresh();
          if (fresh) {
            this.accessToken = fresh;
            refreshed = true;
            continue;
          }
        }
        if (res.status === 429 || res.status === 503) {
          await sleep(1000 * 2 ** attempt + Math.floor(Math.random() * 300));
          continue;
        }
        if (!res.ok) return null;
        const len = Number(res.headers.get('content-length') ?? '');
        if (Number.isFinite(len) && len > maxBytes) return null;
        const contentType = res.headers.get('content-type') || 'application/octet-stream';
        if (!res.body) {
          const buf = Buffer.from(await res.arrayBuffer());
          return buf.length > maxBytes ? null : { bytes: buf, contentType };
        }
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            total += value.length;
            if (total > maxBytes) return null;
            chunks.push(value);
          }
        }
        return { bytes: Buffer.concat(chunks), contentType };
      }
      return null;
    } catch {
      return null; // aborted / network error → skip this file, never throw
    } finally {
      clearTimeout(timer);
      this.signal?.removeEventListener('abort', onAbort);
    }
  }

  /**
   * Fetch a TEAMLY file, following 30x redirects MANUALLY and re-validating that
   * every hop stays on the cluster host. The bearer + slug are only ever sent to
   * the cluster origin, and a redirect can't steer the authed fetch to an
   * internal/arbitrary host (SSRF). Returns null on an off-origin hop or > 3 hops.
   */
  private async fetchFileSameOrigin(
    startUrl: string,
    clusterHost: string,
    signal: AbortSignal,
  ): Promise<Response | null> {
    let current = startUrl;
    for (let hop = 0; hop <= 3; hop++) {
      let host: string;
      try {
        const u = new URL(current);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
        host = u.host.toLowerCase();
      } catch {
        return null;
      }
      if (host !== clusterHost) return null;
      const res = await fetch(current, {
        method: 'GET',
        headers: { 'X-Account-Slug': this.slug, Authorization: `Bearer ${this.accessToken}` },
        redirect: 'manual',
        signal,
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) return res;
        current = new URL(loc, current).toString();
        continue;
      }
      return res;
    }
    return null;
  }

  /** One page of spaces (default type). */
  async listSpaces(page = 1, perPage = 50): Promise<{ items: TeamlySpace[]; lastPage: number }> {
    const body = {
      query: {
        __filter: { keeping_types: ['default'], __text: {}, __nested: { __text: { query: '' } } },
        __sort: [{ created_at: 'desc' }],
        __pagination: { page, per_page: perPage },
        id: true,
        title: true,
        description: true,
        main_article: { id: true },
        // Smart-table columns (T3): a non-empty schemaProperties marks a table.
        schemaProperties: {
          id: true,
          propertyId: true,
          name: true,
          type: true,
          code: true,
          format: true,
          options: true,
          sort: true,
          hide: true,
        },
      },
    };
    const res = await this.request<{ data: TeamlySpace[]; paginate: { last_page: number } }>('/api/v1/wiki/ql/spaces', { method: 'POST', body });
    return { items: res.data ?? [], lastPage: res.paginate?.last_page ?? 1 };
  }

  /** One page of a space's article tree. perPage max 60. */
  async getSpaceTree(spaceId: string, page = 1, perPage = 60): Promise<{ items: TeamlyTreeItem[]; lastPage: number }> {
    const res = await this.request<{ items: TeamlyTreeItem[]; pagination: { lastPage: number } }>(
      `/api/v1/integrations/space/${spaceId}/tree?page=${page}&perPage=${perPage}`,
      { method: 'GET' },
    );
    return { items: res.items ?? [], lastPage: res.pagination?.lastPage ?? 1 };
  }

  /** Full article (body = ProseMirror JSON in editorContentObject.content). */
  async getArticle(id: string): Promise<TeamlyArticle | null> {
    const body = {
      query: {
        __filter: { id },
        id: true,
        title: true,
        icon: true,
        archived: true,
        is_hidden: true,
        created_at: true,
        updated_at: true,
        editorContentObject: { content: true, versionAt: true },
        author: { id: true, full_name: true, external_id: true },
        breadcrumbs: true,
        // Smart-table row values (T3), keyed by property code. Empty for plain articles.
        properties: { properties: true },
      },
    };
    const res = await this.request<TeamlyArticle | null>('/api/v1/wiki/ql/article', { method: 'POST', body });
    return res && res.id ? res : null;
  }
}
