import { prisma } from '@giper/db';
import { SAVED_FILTER_PARAM_KEYS, type SavedFilterScopeInput } from '@giper/shared';

/**
 * True when the URL already carries an explicit filter state — any saved-filter
 * param, the `reset` sentinel the bar sets when the user clears filters, or a
 * bare `page` (a deep-link to page N of an otherwise unfiltered view). When
 * false, a board/list page may auto-apply the viewer's default preset (so an
 * explicit "reset"/pagination is never overridden by the default).
 */
export function hasExplicitFilterState(
  sp: Record<string, string | string[] | undefined>,
): boolean {
  if (sp.reset || sp.page) return true;
  return SAVED_FILTER_PARAM_KEYS.some((k) => {
    const v = sp[k] ?? (k === 'tagIds' ? sp.tagId : undefined);
    if (Array.isArray(v)) return v.length > 0;
    return typeof v === 'string' && v.trim() !== '';
  });
}

export type SavedFilterView = {
  id: string;
  name: string;
  query: string;
  isShared: boolean;
  isDefault: boolean;
  /** True when the current viewer owns this preset (controls edit/delete UI). */
  isMine: boolean;
};

/**
 * Presets visible to `userId` on a given board/list view: the user's OWN presets
 * (any) plus the project's SHARED presets.
 *
 * The project VIEW FLOOR is the CALLER's responsibility. Both call sites (the
 * board + list pages) have already enforced it — board via listTasksForBoard's
 * canViewProject check, list via getProject — before reaching here, so this
 * function trusts `projectId` and skips a redundant (~3-query) project re-load on
 * the hot path. Do NOT call it with a project the caller hasn't view-verified.
 *
 * Ordering: the user's own presets first (own default at the very top), then
 * shared presets — a stable, scannable list for the dropdown.
 */
export async function listSavedFiltersForView(
  projectId: string,
  scope: SavedFilterScopeInput,
  userId: string,
): Promise<SavedFilterView[]> {
  const rows = await prisma.savedFilter.findMany({
    where: {
      projectId,
      scope,
      OR: [{ userId }, { isShared: true }],
    },
    select: {
      id: true,
      name: true,
      query: true,
      isShared: true,
      isDefault: true,
      userId: true,
    },
    orderBy: [{ name: 'asc' }],
  });

  const views: SavedFilterView[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    query: r.query,
    isShared: r.isShared,
    // isDefault is a per-owner preference — only meaningful for the viewer's
    // own rows. A shared preset's default flag belongs to its author, not us.
    isDefault: r.isDefault && r.userId === userId,
    isMine: r.userId === userId,
  }));

  // Own presets first (own default at the top), then shared.
  return views.sort((a, b) => {
    if (a.isMine !== b.isMine) return a.isMine ? -1 : 1;
    if (a.isMine && a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * The query string of the viewer's OWN default preset for this scope, or null.
 * Used to auto-apply a default when the URL carries no filter params. No project
 * view-check needed — it only ever returns the caller's own row (a user can't
 * have a preset in a project they can't see), so this is safe to call directly.
 */
export async function resolveDefaultFilterQuery(
  projectKey: string,
  scope: SavedFilterScopeInput,
  userId: string,
): Promise<string | null> {
  const row = await prisma.savedFilter.findFirst({
    where: {
      project: { key: projectKey },
      scope,
      userId,
      isDefault: true,
    },
    select: { query: true },
    orderBy: { updatedAt: 'desc' },
  });
  return row?.query ?? null;
}
