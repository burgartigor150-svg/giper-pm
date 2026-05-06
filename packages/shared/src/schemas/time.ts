import { z } from 'zod';

export const timeSourceSchema = z.enum([
  'MANUAL_TIMER',
  'MANUAL_FORM',
  'TELEGRAM',
  'AUTO_AGENT',
  'AUTO_BROWSER',
  'DIGITAL_GIT',
  'DIGITAL_CALENDAR',
  'DIGITAL_SLACK',
]);

export const timeFlagSchema = z.enum([
  'REVIEW_NEEDED',
  'GAP_DETECTED',
  'OVERLAPPING',
  'EXCESSIVE',
  'IDLE_LOGGED',
]);

const dateTimeLike = z
  .union([z.string().min(1), z.date()])
  .transform((v) => (v instanceof Date ? v : new Date(v)))
  .refine((d) => !Number.isNaN(d.getTime()), { message: 'Некорректная дата' });

const optionalNote = z
  .string()
  .max(2000)
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    const t = v.trim();
    return t === '' ? undefined : t;
  });

const optionalTaskId = z
  .string()
  .optional()
  .transform((v) => {
    if (v === undefined || v === '') return undefined;
    return v;
  });

const nullableTaskId = z
  .string()
  .nullable()
  .optional()
  .transform((v) => {
    if (v === undefined || v === '' || v === null) return null;
    return v;
  });

export const logTimeSchema = z
  .object({
    taskId: optionalTaskId,
    startedAt: dateTimeLike,
    endedAt: dateTimeLike,
    note: optionalNote,
  })
  .refine((d) => d.endedAt.getTime() > d.startedAt.getTime(), {
    message: 'Окончание должно быть позже начала',
    path: ['endedAt'],
  });
export type LogTimeInput = z.infer<typeof logTimeSchema>;

export const editTimeEntrySchema = z
  .object({
    taskId: nullableTaskId,
    startedAt: dateTimeLike,
    endedAt: dateTimeLike,
    note: optionalNote,
  })
  .refine((d) => d.endedAt.getTime() > d.startedAt.getTime(), {
    message: 'Окончание должно быть позже начала',
    path: ['endedAt'],
  });
export type EditTimeEntryInput = z.infer<typeof editTimeEntrySchema>;

export const timeRangeSchema = z.enum(['today', 'week', 'month', 'custom']).default('week');
export type TimeRange = z.infer<typeof timeRangeSchema>;

export const timeListFilterSchema = z.object({
  range: timeRangeSchema,
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type TimeListFilter = z.infer<typeof timeListFilterSchema>;
