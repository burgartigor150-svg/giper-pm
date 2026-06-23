import { NextResponse } from 'next/server';
import { DomainError } from '@/lib/errors';

/**
 * Uniform JSON envelope for the public REST API. Success → { ok:true, data };
 * error → { ok:false, error:'<lower_snake_code>', message }. Matches the existing
 * /api/public/v1 routes (error is the lowercased code string).
 */
export function apiOk(data: unknown, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status });
}

export function apiFail(code: string, status: number, message?: string): NextResponse {
  return NextResponse.json({ ok: false, error: code.toLowerCase(), message }, { status });
}

export const apiUnauthorized = (): NextResponse => apiFail('unauthorized', 401);

/**
 * Map a thrown error to its HTTP envelope. DomainError → its code/status; anything
 * unexpected → a uniform 500 (logged server-side, message NOT leaked) so every
 * error path stays inside the { ok:false } contract instead of Next's bare 500.
 */
export function apiFromError(e: unknown): NextResponse {
  if (e instanceof DomainError) return apiFail(e.code, e.status, e.message);
  console.error('[kb-api] unexpected error', e);
  return apiFail('internal', 500, 'Внутренняя ошибка');
}

/**
 * Wrap a route handler so any thrown error becomes the uniform envelope (via
 * apiFromError). Preserves the handler's own argument types (req + optional ctx).
 */
export function withApiErrors<A extends unknown[]>(
  handler: (req: Request, ...args: A) => Promise<NextResponse> | NextResponse,
): (req: Request, ...args: A) => Promise<NextResponse> {
  return async (req: Request, ...args: A): Promise<NextResponse> => {
    try {
      return await handler(req, ...args);
    } catch (e) {
      return apiFromError(e);
    }
  };
}
