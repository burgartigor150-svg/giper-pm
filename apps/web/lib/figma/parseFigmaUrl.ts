export type ParsedFigma = {
  /** Figma file key. */
  fileKey: string;
  /** Node/frame id in API form ("1:23"), or null for the whole file. */
  nodeId: string | null;
  /** Human title derived from the URL slug. */
  title: string;
};

/**
 * Parse a Figma share URL into its file key + optional node id + a title.
 * Accepts file / design / proto / board links on figma.com. Returns null for
 * anything that isn't a recognizable Figma file URL.
 *
 *   https://www.figma.com/design/AbC123/My-Flow?node-id=12-34  →
 *     { fileKey: 'AbC123', nodeId: '12:34', title: 'My Flow' }
 */
export function parseFigmaUrl(raw: string): ParsedFigma | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)figma\.com$/i.test(u.hostname)) return null;

  const m = u.pathname.match(/\/(?:file|design|proto|board)\/([A-Za-z0-9]+)(?:\/([^/?#]*))?/);
  if (!m) return null;

  const fileKey = m[1]!;
  const slug = m[2] ? decodeURIComponent(m[2]).replace(/-/g, ' ').trim() : '';
  const rawNode = u.searchParams.get('node-id');
  // URLs use a dash separator (12-34); the REST API uses a colon (12:34).
  const nodeId = rawNode ? rawNode.replace(/-/g, ':') : null;
  return { fileKey, nodeId, title: slug || 'Figma' };
}

/**
 * Official Figma embed URL for an <iframe>. No token required — works for files
 * shared with "anyone with the link". Pass the ORIGINAL Figma URL.
 */
export function figmaEmbedUrl(url: string): string {
  return `https://www.figma.com/embed?embed_host=giper-pm&url=${encodeURIComponent(url)}`;
}
