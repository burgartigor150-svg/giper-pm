import { z } from 'zod';

export const versionStatusSchema = z.enum(['PLANNED', 'RELEASED', 'ARCHIVED']);
export type VersionStatusInput = z.infer<typeof versionStatusSchema>;

const versionName = z.string().trim().min(2, 'Минимум 2 символа').max(80);
const versionDescription = z
  .string()
  .max(2000)
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    const t = v.trim();
    return t === '' ? null : t;
  });
const versionReleaseDate = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.string().length(0), z.null()])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    if (v === null || v.length === 0) return null;
    return new Date(`${v}T00:00:00.000Z`);
  });

export const createVersionSchema = z.object({
  projectKey: z.string().min(1).max(20),
  name: versionName,
  description: versionDescription,
  releaseDate: versionReleaseDate,
});
export type CreateVersionInput = z.input<typeof createVersionSchema>;

export const updateVersionSchema = z.object({
  name: versionName.optional(),
  description: versionDescription,
  releaseDate: versionReleaseDate,
});
export type UpdateVersionInput = z.input<typeof updateVersionSchema>;
