/**
 * Public site origin for absolute links (used in instructions / share buttons).
 * Prefer AUTH_URL (Auth.js / prod compose). Optional NEXT_PUBLIC_APP_URL fallback.
 */
export function siteOrigin(): string {
  const auth = process.env.AUTH_URL?.trim();
  if (auth) return auth.replace(/\/$/, '');
  const pub = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (pub) return pub.replace(/\/$/, '');
  return '';
}
