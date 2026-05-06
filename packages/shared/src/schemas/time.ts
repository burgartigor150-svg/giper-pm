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

export const logTimeSchema = z
  .object({
    taskId: z.string().min(1).optional().or(z.literal('').transform(() => undefined)),
    startedAt: dateTimeLike,
    endedAt: dateTimeLike,
    note: z.string().trim().max(2000).optional().or(z.literal('').transform(() => undefined)),
  })
  .refine((d) => d.endedAt.getTime() > d.startedAt.getTime(), {
    message: 'Окончание должно быть позже начала',
    path: ['endedAt'],
  });
export type LogTimeInput = z.infer<typeof logTimeSchema>;

export const editTimeEntrySchema = z
  .object({
    taskId: z.string().min(1).optional().nullable().or(z.literal('').transform(() => null)),
    startedAt: dateTimeLike,
    endedAt: dateTimeLike,
    note: z.string().trim().max(2000).optional().or(z.literal('').transform(() => undefined)),
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
