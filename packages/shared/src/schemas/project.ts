import { z } from 'zod';

export const PROJECT_KEY_REGEX = /^[A-Z]{2,5}$/;

export const projectKeySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(PROJECT_KEY_REGEX, 'Ключ: 2–5 заглавных латинских букв');

export const memberRoleSchema = z.enum(['LEAD', 'CONTRIBUTOR', 'REVIEWER', 'OBSERVER']);
export type MemberRoleInput = z.infer<typeof memberRoleSchema>;

export const projectStatusSchema = z.enum(['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED']);
export type ProjectStatusInput = z.infer<typeof projectStatusSchema>;

const baseProjectFields = {
  name: z.string().trim().min(2, 'Имя минимум 2 символа').max(80),
  description: z.string().trim().max(2000).optional().or(z.literal('').transform(() => undefined)),
  client: z.string().trim().max(120).optional().or(z.literal('').transform(() => undefined)),
  deadline: z
    .union([z.string().datetime(), z.string().length(0), z.date()])
    .optional()
    .transform((v) => {
      if (!v) return undefined;
      if (v instanceof Date) return v;
      if (v.length === 0) return undefined;
      return new Date(v);
    }),
  budgetHours: z.coerce.number().nonnegative().max(100_000).optional(),
  hourlyRate: z.coerce.number().nonnegative().max(1_000_000).optional(),
};

export const createProjectSchema = z.object({
  ...baseProjectFields,
  key: projectKeySchema,
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  ...baseProjectFields,
  status: projectStatusSchema.optional(),
});
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const addMemberSchema = z.object({
  userId: z.string().min(1),
  role: memberRoleSchema,
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;

/**
 * Auto-generate project key from a free-form name.
 *  - Cyrillic words get romanised first.
 *  - Take first letter of each word, uppercase.
 *  - If less than 2 letters → pad with letters from the first word.
 *  - If more than 5 → truncate.
 *  - Only A-Z survives.
 */
export function generateProjectKey(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return 'PRJ';

  const romanised = romaniseCyrillic(cleaned);
  const words = romanised
    .split(/[^A-Za-z0-9]+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ''))
    .filter(Boolean);

  if (words.length === 0) return 'PRJ';

  let key = words.map((w) => w[0]!.toUpperCase()).join('');

  if (key.length < 2) {
    const filler = words[0]!.toUpperCase();
    key = (key + filler).slice(0, Math.max(2, Math.min(5, filler.length)));
  }

  if (key.length > 5) key = key.slice(0, 5);
  if (key.length < 2) key = (key + 'PRJ').slice(0, 3);

  return key;
}

const ROMAN_MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh',
  з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c',
  ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function romaniseCyrillic(s: string): string {
  return [...s.toLowerCase()]
    .map((ch) => (ROMAN_MAP[ch] !== undefined ? ROMAN_MAP[ch] : ch))
    .join('');
}
