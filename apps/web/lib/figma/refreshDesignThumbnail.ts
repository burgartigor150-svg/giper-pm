import { prisma } from '@giper/db';
import { getActiveFigmaToken, figmaImagesForNodes, figmaFileMeta } from './figmaApi';

/**
 * Populate a TaskDesign's thumbnailUrl from the Figma API. Best-effort:
 *   - no token connected → no-op (the live embed still works);
 *   - has a nodeId → render that specific frame;
 *   - otherwise → the whole-file thumbnail.
 * Figma image URLs are temporary, so this is re-run lazily (on attach + a
 * periodic refresh) rather than relied on as permanent.
 */
export async function refreshDesignThumbnail(designId: string): Promise<void> {
  const token = await getActiveFigmaToken();
  if (!token) return;
  const d = await prisma.taskDesign.findUnique({
    where: { id: designId },
    select: { id: true, fileKey: true, nodeId: true },
  });
  if (!d) return;
  try {
    let thumb: string | null = null;
    if (d.nodeId) {
      const map = await figmaImagesForNodes(d.fileKey, [d.nodeId], token);
      thumb = map[d.nodeId] ?? null;
    }
    if (!thumb) {
      const meta = await figmaFileMeta(d.fileKey, token);
      thumb = meta.thumbnailUrl;
    }
    if (thumb) {
      await prisma.taskDesign.update({ where: { id: d.id }, data: { thumbnailUrl: thumb } });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('figma: refreshDesignThumbnail failed', designId, e);
  }
}
