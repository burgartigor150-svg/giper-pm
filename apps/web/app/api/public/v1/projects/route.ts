import { NextResponse } from 'next/server';
import { resolveApiToken } from '@/lib/api/resolveApiToken';
import { listProjectsForUser } from '@/lib/projects/listProjectsForUser';

/**
 * GET /api/public/v1/projects — projects visible to the token owner.
 * Auth: Authorization: Bearer gpm_… (see ApiToken). Read-only.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const user = await resolveApiToken(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const projects = await listProjectsForUser(user);
  return NextResponse.json({
    ok: true,
    data: projects.map((p) => ({
      key: p.key,
      name: p.name,
      status: p.status,
    })),
  });
}
