import { NextResponse } from 'next/server';
import { baseUrl } from '@/lib/oauth/core';

/** RFC 9728 — OAuth Protected Resource Metadata. Points MCP clients from the
 *  resource (/api/mcp) to this deployment's authorization server. */
export const dynamic = 'force-dynamic';

export function GET() {
  const base = baseUrl();
  return NextResponse.json({
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ['header'],
  });
}
