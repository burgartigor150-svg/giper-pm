import { z } from 'zod';

export const savedFilterScopeSchema = z.enum(['BOARD', 'LIST']);
export type SavedFilterScopeInput = z.infer<typeof savedFilterScopeSchema>;

/**
 * Every URL param a saved board/list filter may carry. `page` is intentionally
 * excluded — presets save FILTER state, not pagination position. Any param not
 * in this set is rejected so a stored preset can never smuggle arbitrary query
 * keys that the page might interpret.
 */
export const SAVED_FILTER_PARAM_KEYS = [
  'q',
  'assigneeId',
  'priority',
  'status',
  'type',
  'dueWithin',
  'reviewer',
  'tagIds',
  'onlyMine',
  'sprintId',
  'sort',
  'dir',
] as const;
const ALLOWED_PARAMS = new Set<string>(SAVED_FILTER_PARAM_KEYS);

export const MAX_SAVED_FILTER_QUERY = 2000;

/**
 * Canonicalize a saved-filter query string: drop `page` and empty params, reject
 * any unknown key, and sort keys (then values) so two equivalent filters compare
 * equal regardless of param order — this makes the "active preset" highlight
 * stable. Returns the normalized "k=v&k=v" string (no leading "?"), or null if
 * the input is too long or contains an unknown param key (fail-closed).
 */
export function normalizeFilterQuery(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_SAVED_FILTER_QUERY) return null;
  const input = raw.startsWith('?') ? raw.slice(1) : raw;
  const sp = new URLSearchParams(input);
  const pairs: [string, string][] = [];
  for (const [k, v] of sp.entries()) {
    if (k === 'page') continue; // never persist pagination position
    if (!ALLOWED_PARAMS.has(k)) return null; // unknown key → fail closed
    if (v.trim() === '') continue;
    pairs.push([k, v]);
  }
  pairs.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  const out = new URLSearchParams();
  for (const [k, v] of pairs) out.append(k, v);
  return out.toString();
}

/** A query string that validates + normalizes to the canonical form. */
export const savedFilterQuerySchema = z
  .string()
  .max(MAX_SAVED_FILTER_QUERY)
  .transform((s, ctx) => {
    const norm = normalizeFilterQuery(s);
    if (norm === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Недопустимый фильтр' });
      return z.NEVER;
    }
    return norm;
  });

export const savedFilterNameSchema = z.string().trim().min(2, 'Минимум 2 символа').max(80);

export const createSavedFilterSchema = z.object({
  projectKey: z.string().min(1).max(20),
  scope: savedFilterScopeSchema,
  name: savedFilterNameSchema,
  query: savedFilterQuerySchema,
  isShared: z.boolean().optional().default(false),
  isDefault: z.boolean().optional().default(false),
});
// The action accepts the pre-parse INPUT shape (isShared/isDefault optional);
// z.infer would give the post-default OUTPUT shape and wrongly require them.
export type CreateSavedFilterInput = z.input<typeof createSavedFilterSchema>;

export const updateSavedFilterSchema = z.object({
  name: savedFilterNameSchema.optional(),
  query: savedFilterQuerySchema.optional(),
  isShared: z.boolean().optional(),
});
export type UpdateSavedFilterInput = z.input<typeof updateSavedFilterSchema>;
