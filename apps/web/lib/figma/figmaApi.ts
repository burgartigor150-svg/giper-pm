import { prisma } from '@giper/db';
import { decryptToken } from '@/lib/tgTokenCrypto';

const FIGMA_API = 'https://api.figma.com';

/**
 * The org-level Figma personal access token (decrypted), or null when Figma
 * isn't connected. Everything that calls the Figma REST API goes through this —
 * a null token means "skip, best-effort" so embeds keep working without it.
 */
export async function getActiveFigmaToken(): Promise<string | null> {
  const conn = await prisma.figmaConnection.findFirst({
    where: { singleton: 'figma' },
    select: { tokenEnc: true },
  });
  if (!conn) return null;
  try {
    return decryptToken(conn.tokenEnc);
  } catch {
    return null;
  }
}

async function figmaGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${FIGMA_API}${path}`, {
    headers: { 'X-Figma-Token': token },
    // Figma data changes rarely between our calls; never cache auth'd responses.
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Figma ${path} → ${res.status} ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** Validate a token + return the account (used on connect). */
export async function figmaMe(token: string): Promise<{ id: string; email?: string; handle?: string }> {
  return figmaGet('/v1/me', token);
}

/**
 * Rendered PNG URLs for specific nodes/frames. Returns a map nodeId → url.
 * `ids` uses the API node form ("12:34"). Figma's image URLs are temporary
 * (expire ~30 days) — we store them and refresh lazily.
 */
export async function figmaImagesForNodes(
  fileKey: string,
  nodeIds: string[],
  token: string,
): Promise<Record<string, string | null>> {
  if (nodeIds.length === 0) return {};
  const ids = encodeURIComponent(nodeIds.join(','));
  const data = await figmaGet<{ images: Record<string, string | null>; err?: string | null }>(
    `/v1/images/${fileKey}?ids=${ids}&format=png&scale=1`,
    token,
  );
  return data.images ?? {};
}

/** File metadata incl. the whole-file thumbnail URL + display name. */
export async function figmaFileMeta(
  fileKey: string,
  token: string,
): Promise<{ name: string; thumbnailUrl: string | null }> {
  const data = await figmaGet<{ name?: string; thumbnailUrl?: string | null }>(
    `/v1/files/${fileKey}?depth=1`,
    token,
  );
  return { name: data.name ?? 'Figma', thumbnailUrl: data.thumbnailUrl ?? null };
}

export type FigmaComment = {
  id: string;
  message: string;
  created_at: string;
  user?: { handle?: string; img_url?: string };
};

/** All comments on a Figma file (newest-first not guaranteed; we sort). */
export async function figmaFileComments(fileKey: string, token: string): Promise<FigmaComment[]> {
  const data = await figmaGet<{ comments: FigmaComment[] }>(`/v1/files/${fileKey}/comments`, token);
  return data.comments ?? [];
}
