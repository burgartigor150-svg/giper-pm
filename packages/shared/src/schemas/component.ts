import { z } from 'zod';

const componentName = z.string().trim().min(2, 'Минимум 2 символа').max(80);
const componentDescription = z
  .string()
  .max(2000)
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    const t = v.trim();
    return t === '' ? null : t;
  });
const componentLeadId = z
  .union([z.string().min(1), z.string().length(0), z.null()])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    if (v === null || v.length === 0) return null;
    return v;
  });

export const createComponentSchema = z.object({
  projectKey: z.string().min(1).max(20),
  name: componentName,
  description: componentDescription,
  leadId: componentLeadId,
});
export type CreateComponentInput = z.input<typeof createComponentSchema>;

export const updateComponentSchema = z.object({
  name: componentName.optional(),
  description: componentDescription,
  leadId: componentLeadId,
});
export type UpdateComponentInput = z.input<typeof updateComponentSchema>;
