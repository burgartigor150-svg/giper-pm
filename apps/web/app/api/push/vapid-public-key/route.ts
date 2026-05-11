import { NextResponse } from 'next/server';

/**
 * Expose the VAPID public key to the browser so PushManager.subscribe
 * can encrypt the subscription. Public-key, safe to serve to anyone
 * — the matching private key never leaves the server.
 *
 * Returns 503 when the server isn't configured for push (env vars
 * missing), so the client can hide the opt-in UI cleanly instead of
 * showing a button that crashes.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const pub = process.env.VAPID_PUBLIC_KEY?.trim();
  if (!pub) {
    return NextResponse.json({ enabled: false }, { status: 503 });
  }
  return NextResponse.json({ enabled: true, publicKey: pub });
}
