import { prisma } from '@giper/db';

const PALETTE = [
  '#94a3b8',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
];

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-zа-я0-9]+/giu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'tag'
  );
}

function pickColorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length] ?? '#94a3b8';
}

/**
 * Resolve free-text tag names to relational Tag rows (find-or-create per
 * project, keyed by slug) and link them to a task via TaskTag. Used when a
 * task is created with tags typed in the new-task form — the relational
 * Tag/TaskTag system is what powers the board chips, list filter and detail
 * view (the scalar Task.tags is a read-only Bitrix mirror). Idempotent.
 */
export async function linkTagsByName(
  projectId: string,
  taskId: string,
  names: string[],
  assignedById: string,
): Promise<void> {
  // Dedupe by slug; cap to a sane number so a pasted blob can't explode.
  const bySlug = new Map<string, string>();
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const slug = slugify(name);
    if (!bySlug.has(slug)) bySlug.set(slug, name);
    if (bySlug.size >= 20) break;
  }

  for (const [slug, name] of bySlug) {
    const tag = await prisma.tag.upsert({
      where: { projectId_slug: { projectId, slug } },
      create: { projectId, name: name.slice(0, 40), slug, color: pickColorFor(name) },
      update: {},
      select: { id: true },
    });
    await prisma.taskTag.upsert({
      where: { taskId_tagId: { taskId, tagId: tag.id } },
      create: { taskId, tagId: tag.id, assignedById },
      update: {},
    });
  }
}
