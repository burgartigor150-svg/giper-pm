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

/** Map a thrown DomainError to its HTTP envelope; rethrow anything unexpected. */
export function apiFromError(e: unknown): NextResponse {
  if (e instanceof DomainError) return apiFail(e.code, e.status, e.message);
  throw e;
}
