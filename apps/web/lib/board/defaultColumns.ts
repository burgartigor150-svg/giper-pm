import type { TaskStatus } from '@giper/db';

/**
 * The default board columns a project shows before it customises its own. The
 * board synthesises these when a project has no BoardColumn rows; S2's
 * migration materialises the same set as real rows. CANCELED is intentionally
 * absent — the board hides cancelled work.
 *
 * Leaf module (only a type import) so it's safe to pull into the test factory /
 * backfill without dragging server-only code.
 */
export const DEFAULT_BOARD_COLUMNS: ReadonlyArray<{ status: TaskStatus; name: string }> = [
  { status: 'BACKLOG', name: 'Бэклог' },
  { status: 'TODO', name: 'К работе' },
  { status: 'IN_PROGRESS', name: 'В работе' },
  { status: 'REVIEW', name: 'На ревью' },
  { status: 'BLOCKED', name: 'Заблокирована' },
  { status: 'DONE', name: 'Готово' },
];
