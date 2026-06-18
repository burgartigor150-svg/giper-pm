/**
 * Reject webhook URLs that point at the local host, private networks, link-
 * local, or cloud-metadata endpoints — the common SSRF targets. Checks IP
 * literals directly; for hostnames it blocks obvious local suffixes.
 *
 * Residual risk: a hostname that resolves to a private IP (DNS rebinding)
 * isn't caught here — a fuller guard would resolve + re-check at send time.
 * `redirect: 'manual'` in the dispatcher blocks redirect-based bypass.
 */
export function isSafeWebhookUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost')
  ) {
    return false;
  }
  // IPv6 loopback / unique-local / link-local.
  if (host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
    return false;
  }
  // IPv4 literal private / reserved ranges.
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 127 || a === 10) return false; // this-host, loopback, private
    if (a === 169 && b === 254) return false; // link-local + cloud metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return false; // private
    if (a === 192 && b === 168) return false; // private
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a >= 224) return false; // multicast / reserved
  }
  return true;
}
