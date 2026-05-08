import { z } from 'zod';

export const taskStatusSchema = z.enum([
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'REVIEW',
  'BLOCKED',
  'DONE',
  'CANCELED',
]);
export type TaskStatusInput = z.infer<typeof taskStatusSchema>;

export const taskPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
export type TaskPriorityInput = z.infer<typeof taskPrioritySchema>;

export const taskTypeSchema = z.enum(['TASK', 'BUG', 'FEATURE', 'EPIC', 'CHORE']);
export type TaskTypeInput = z.infer<typeof taskTypeSchema>;

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      const t = v.trim();
      return t === '' ? undefined : t;
    });

const optionalDate = z
  .union([z.string().datetime(), z.string().length(0), z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.date()])
  .optional()
  .transform((v) => {
    if (!v) return undefined;
    if (v instanceof Date) return v;
    if (v.length === 0) return undefined;
    return new Date(v);
  });

export const tagsSchema = z
  .union([
    z.array(z.string().trim().min(1).max(32)),
    z
      .string()
      .trim()
      .transform((s) =>
        s
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      ),
  ])
  .optional()
  .transform((v) => v ?? []);

export const createTaskSchema = z.object({
  projectKey: z.string().regex(/^[A-Z]{2,5}$/),
  title: z.string().trim().min(2, 'Минимум 2 символа').max(200),
  description: optionalText(20_000),
  priority: taskPrioritySchema.optional(),
  type: taskTypeSchema.optional(),
  assigneeId: z.string().min(1).optional().or(z.literal('').transform(() => undefined)),
  estimateHours: z.coerce.number().nonnegative().max(10_000).optional(),
  dueDate: optionalDate,
  tags: tagsSchema,
  parentId: z.string().min(1).optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  description: optionalText(20_000),
  priority: taskPrioritySchema.optional(),
  type: taskTypeSchema.optional(),
  estimateHours: z.coerce.number().nonnegative().max(10_000).optional(),
  dueDate: optionalDate,
  tags: tagsSchema,
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const changeStatusSchema = z.object({
  status: taskStatusSchema,
});

export const assignTaskSchema = z.object({
  assigneeId: z.string().min(1).nullable().or(z.literal('').transform(() => null)),
});

export const commentVisibilitySchema = z.enum(['EXTERNAL', 'INTERNAL']);

export const addCommentSchema = z.object({
  body: z.string().trim().min(1, 'Пустой комментарий').max(10_000),
  visibility: commentVisibilitySchema.optional().default('EXTERNAL'),
});

export const taskListFilterSchema = z.object({
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assigneeId: z.string().optional(),
  q: z.string().trim().max(200).optional(),
  /** Tag IDs the task must have (AND-semantics). */
  tagIds: z.array(z.string()).optional(),
  page: z.coerce.number().int().min(1).default(1),
  sort: z
    .enum(['number', 'title', 'status', 'priority', 'estimateHours', 'dueDate', 'assignee'])
    .default('number'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type TaskListFilter = z.infer<typeof taskListFilterSchema>;

export const TASKS_PAGE_SIZE = 50;
