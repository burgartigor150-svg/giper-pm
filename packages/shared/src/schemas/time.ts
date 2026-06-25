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
  // Written by enforceTimerLimits (timeLimits.ts) when a runaway timer is
  // closed by the system. Was missing here, so anything validating a flag
  // through this schema rejected a value the DB legitimately produces.
  'AUTO_STOPPED',
]);

/** Manual work-phase a time entry belongs to (what the user did on the task). */
export const workStageSchema = z.enum(['DISCOVERY', 'ANALYSIS', 'DEVELOPMENT', 'TESTING', 'MEETING']);
export type WorkStage = z.infer<typeof workStageSchema>;

const dateTimeLike = z
  .union([z.string().min(1), z.date()])
  .transform((v) => (v instanceof Date ? v : new Date(v)))
  .refine((d) => !Number.isNaN(d.getTime()), { message: 'Некорректная дата' });

/** Free-form label for a no-task entry; '' / blank → undefined. */
const optionalName = z
  .string()
  .max(200)
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    const t = v.trim();
    return t === '' ? undefined : t;
  });

/** Stage on create: a valid stage or '' (→ undefined). */
const optionalStage = z
  .union([workStageSchema, z.literal('')])
  .optional()
  .transform((v) => (v === undefined || v === '' ? undefined : v));

/**
 * Name on edit: omitted → undefined (keeps the key OPTIONAL on the inferred
 * type — a transform that never yields undefined would force it required);
 * present-but-blank → null (clears it). Capped at 200 like the create path.
 */
const nullableName = z
  .string()
  .max(200)
  .nullable()
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    const t = (v ?? '').trim();
    return t === '' ? null : t;
  });

/** Stage on edit: omitted → undefined (key stays optional); '' / null → null (clears). */
const nullableStage = z
  .union([workStageSchema, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v || null));

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
    // Omitted → undefined keeps the inferred key OPTIONAL (a transform that only
    // ever yields string|null forces it required); present-but-blank/null → null
    // (clears the task). editTimeEntry coalesces undefined→null on write, so the
    // stored value is unchanged.
    if (v === undefined) return undefined;
    return v === '' || v === null ? null : v;
  });

export const logTimeSchema = z
  .object({
    taskId: optionalTaskId,
    startedAt: dateTimeLike,
    endedAt: dateTimeLike,
    note: optionalNote,
    name: optionalName,
    stage: optionalStage,
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
    name: nullableName,
    stage: nullableStage,
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
