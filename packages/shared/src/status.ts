/**
 * Deterministic id of a project's seeded Status for a given category / legacy
 * TaskStatus value. Mirrors the S1 migration seed scheme `st_<projectId>_<CAT>`
 * so any layer (web cores, integration sync, migrations) can compute the FK
 * without a lookup. Shared here because both `apps/web` and
 * `packages/integrations` need it.
 */
export function statusSeedId(projectId: string, category: string): string {
  return `st_${projectId}_${category}`;
}
