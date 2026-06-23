import { requireAuth } from '@/lib/auth';
import { getArticle } from '@/lib/knowledge/getKnowledge';
import { getSpaceAccessById } from '@/lib/knowledge/access';
import { extractTableIds } from '@/lib/knowledge/renderMarkdown';
import { getTable, getRelatedRowLabels } from '@/lib/knowledge/getTables';
import { articleToDocx, type DocxTableData } from '@/lib/knowledge/articleToDocx';

/**
 * GET /api/knowledge/articles/:id/export — download the article as a .docx.
 * Session-authenticated (in-app); requires canView on the article's space.
 * Embedded smart tables are access-checked per space and capped, mirroring the
 * article reader.
 */
export const dynamic = 'force-dynamic';

const MAX_EMBEDS = 20;

type Ctx = { params: Promise<{ id: string }> };

/** Strip to ASCII for the legacy `filename=` header (UTF-8 name goes in filename*). */
function asciiFallback(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, '_') || 'article';
}

export async function GET(_req: Request, { params }: Ctx) {
  let me: Awaited<ReturnType<typeof requireAuth>>;
  try {
    me = await requireAuth();
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }
  const { id } = await params;

  const article = await getArticle(id);
  if (!article) return new Response('Not found', { status: 404 });
  const access = await getSpaceAccessById(me, article.spaceId);
  if (!access.canView) return new Response('Not found', { status: 404 });

  let buf: Buffer;
  try {
    // Resolve embedded tables (access-checked per space, capped) + relation labels.
    const ids = extractTableIds(article.content).slice(0, MAX_EMBEDS);
    const fetched = (await Promise.all(ids.map((tid) => getTable(tid)))).filter(
      (t): t is NonNullable<typeof t> => t !== null,
    );
    const checks = await Promise.all(fetched.map((t) => getSpaceAccessById(me, t.spaceId)));
    const viewable = fetched.filter((_, idx) => checks[idx]?.canView);

    const relTargets = viewable.flatMap((t) =>
      t.columns.filter((c) => c.type === 'RELATION' && c.relationTableId).map((c) => c.relationTableId as string),
    );
    const relations = relTargets.length ? await getRelatedRowLabels(relTargets) : {};

    const tables: Record<string, DocxTableData> = {};
    for (const t of viewable) {
      tables[t.id] = { name: t.name, columns: t.columns, rows: t.rows, relations };
    }

    buf = await articleToDocx({ title: article.title, content: article.content }, tables);
  } catch (e) {
    console.error(`[kb-export] failed to build docx for article ${id}`, e);
    return new Response('Export failed', { status: 500 });
  }

  const safe = (article.title || 'article').replace(/[^\p{L}\p{N} ._-]/gu, '').trim() || 'article';
  const headers = new Headers();
  headers.set('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  headers.set(
    'content-disposition',
    `attachment; filename="${asciiFallback(safe)}.docx"; filename*=UTF-8''${encodeURIComponent(safe)}.docx`,
  );
  headers.set('cache-control', 'private, no-store');
  return new Response(new Uint8Array(buf), { status: 200, headers });
}
