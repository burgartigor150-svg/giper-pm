import { Redis } from 'ioredis';

/**
 * Best-effort fixed-window rate limiter for the public API, backed by Redis
 * (same instance as the AI-harvest cooldown). It FAILS OPEN: when REDIS_URL is
 * unset or Redis is unreachable, calls are allowed — the limiter is an abuse
 * brake, not an authz gate, so it must never take the API down.
 */
let _redis: Redis | null = null;
let _disabled = false;

function redis(): Redis | null {
  if (_disabled) return null;
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) {
    _disabled = true;
    return null;
  }
  _redis = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  _redis.on('error', () => {}); // swallow — limiter fails open
  return _redis;
}

export type RateLimitResult = { ok: boolean; retryAfter?: number };

/**
 * Best-effort client IP for rate-limit keys. The app runs behind nginx, which
 * sets X-Forwarded-For (client first) / X-Real-IP. Falls back to 'unknown' so a
 * missing header degrades to a single shared bucket rather than throwing.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * Allow up to `limit` calls per `windowSec` for `key`. Returns { ok:false,
 * retryAfter } once the window is exceeded.
 */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  const r = redis();
  if (!r) return { ok: true };
  try {
    const k = `ratelimit:${key}`;
    const n = await r.incr(k);
    if (n === 1) await r.expire(k, windowSec);
    if (n > limit) {
      const ttl = await r.ttl(k);
      return { ok: false, retryAfter: ttl > 0 ? ttl : windowSec };
    }
    return { ok: true };
  } catch {
    return { ok: true }; // fail open
  }
}
