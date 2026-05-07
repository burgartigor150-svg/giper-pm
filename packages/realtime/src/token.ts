import { SignJWT } from 'jose';

/**
 * Mint a short-lived WS-auth token. The browser presents it as
 * `?token=...` when opening the WebSocket; the WS server verifies the
 * signature and reads `sub` for the user id.
 *
 * Lifetime is short (15 min) because the client refreshes via a server
 * action when the token is about to expire — saves us from having to
 * trust the client with a long-lived secret.
 */
export async function mintWsToken(opts: {
  userId: string;
  secret: string;
  ttlSeconds?: number;
}): Promise<string> {
  const { userId, secret, ttlSeconds = 900 } = opts;
  const key = new TextEncoder().encode(secret);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key);
}
