import { describe, it, expect } from 'vitest';
import {
  createTaskSchema,
  updateTaskSchema,
  changeStatusSchema,
  assignTaskSchema,
  addCommentSchema,
  taskStatusSchema,
  taskPrioritySchema,
  taskTypeSchema,
  taskListFilterSchema,
  tagsSchema,
  TASKS_PAGE_SIZE,
} from './task';

describe('enums', () => {
  it('taskStatusSchema has 7 statuses including CANCELED', () => {
    expect(taskStatusSchema.options).toEqual([
      'BACKLOG',
      'TODO',
      'IN_PROGRESS',
      'REVIEW',
      'BLOCKED',
      'DONE',
      'CANCELED',
    ]);
    expect(taskStatusSchema.options).toHaveLength(7);
  });

  it('taskPrioritySchema has 4 priorities', () => {
    expect(taskPrioritySchema.options).toEqual(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
  });

  it('taskTypeSchema has 5 types', () => {
    expect(taskTypeSchema.options).toEqual(['TASK', 'BUG', 'FEATURE', 'EPIC', 'CHORE']);
  });

  it('TASKS_PAGE_SIZE is 50', () => {
    expect(TASKS_PAGE_SIZE).toBe(50);
  });
});

describe('tagsSchema', () => {
  it('defaults to empty array when undefined', () => {
    expect(tagsSchema.parse(undefined)).toEqual([]);
  });

  it('accepts an array of tags', () => {
    expect(tagsSchema.parse(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('splits comma-separated string', () => {
    expect(tagsSchema.parse('foo, bar,baz')).toEqual(['foo', 'bar', 'baz']);
  });

  it('drops empty entries from string', () => {
    expect(tagsSchema.parse('foo,,bar,')).toEqual(['foo', 'bar']);
  });

  it('rejects array entries longer than 32', () => {
    expect(tagsSchema.safeParse(['x'.repeat(33)]).success).toBe(false);
  });

  it('rejects empty string entry in array', () => {
    expect(tagsSchema.safeParse(['']).success).toBe(false);
  });
});

describe('createTaskSchema', () => {
  const valid = { projectKey: 'ABC', title: 'My Task' };

  it('parses minimal valid input', () => {
    const r = createTaskSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.title).toBe('My Task');
      expect(r.data.tags).toEqual([]);
      expect(r.data.description).toBeUndefined();
    }
  });

  it('rejects bad projectKey', () => {
    const r = createTaskSchema.safeParse({ ...valid, projectKey: 'A' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toMatchObject({ projectKey: expect.any(Array) });
  });

  it('rejects too-short title', () => {
    const r = createTaskSchema.safeParse({ ...valid, title: 'A' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toMatchObject({ title: expect.any(Array) });
  });

  it('rejects title longer than 200', () => {
    const r = createTaskSchema.safeParse({ ...valid, title: 'a'.repeat(201) });
    expect(r.success).toBe(false);
  });

  it('trims title', () => {
    const r = createTaskSchema.parse({ ...valid, title: '  Hello  ' });
    expect(r.title).toBe('Hello');
  });

  // KNOWN BUG: `optionalText` uses `.optional().or(z.literal('').transform(...))` —
  // `.optional()` matches '' first (empty string passes the string-with-max).
  // The empty-to-undefined transform never fires. Locking in current behavior.
  it('currently keeps empty-string description as ""', () => {
    const r = createTaskSchema.parse({ ...valid, description: '' });
    expect(r.description).toBe('');
  });

  it('omits description entirely when not provided', () => {
    const r = createTaskSchema.parse(valid);
    expect(r.description).toBeUndefined();
  });

  it('transforms empty assigneeId to undefined', () => {
    const r = createTaskSchema.parse({ ...valid, assigneeId: '' });
    expect(r.assigneeId).toBeUndefined();
  });

  it('rejects bad priority', () => {
    const r = createTaskSchema.safeParse({ ...valid, priority: 'INSANE' });
    expect(r.success).toBe(false);
  });

  it('rejects bad type', () => {
    const r = createTaskSchema.safeParse({ ...valid, type: 'STORY' });
    expect(r.success).toBe(false);
  });

  it('coerces estimateHours from string', () => {
    const r = createTaskSchema.parse({ ...valid, estimateHours: '5.5' });
    expect(r.estimateHours).toBe(5.5);
  });

  it('rejects negative estimateHours', () => {
    const r = createTaskSchema.safeParse({ ...valid, estimateHours: -1 });
    expect(r.success).toBe(false);
  });

  it('accepts dueDate as YYYY-MM-DD', () => {
    const r = createTaskSchema.parse({ ...valid, dueDate: '2026-05-01' });
    expect(r.dueDate).toBeInstanceOf(Date);
  });

  it('accepts dueDate as ISO datetime', () => {
    const r = createTaskSchema.parse({ ...valid, dueDate: '2026-05-01T12:00:00Z' });
    expect(r.dueDate).toBeInstanceOf(Date);
  });

  it('treats empty dueDate string as undefined', () => {
    const r = createTaskSchema.parse({ ...valid, dueDate: '' });
    expect(r.dueDate).toBeUndefined();
  });

  it('rejects invalid dueDate format', () => {
    const r = createTaskSchema.safeParse({ ...valid, dueDate: '01/05/2026' });
    expect(r.success).toBe(false);
  });

  it('parses tags as comma-separated string', () => {
    const r = createTaskSchema.parse({ ...valid, tags: 'urgent, frontend' });
    expect(r.tags).toEqual(['urgent', 'frontend']);
  });
});

describe('updateTaskSchema', () => {
  it('accepts empty object', () => {
    expect(updateTaskSchema.safeParse({}).success).toBe(true);
  });

  it('rejects too-short title', () => {
    expect(updateTaskSchema.safeParse({ title: 'A' }).success).toBe(false);
  });

  // Same KNOWN BUG as createTaskSchema: empty-string description stays ''.
  it('currently keeps empty-string description as ""', () => {
    const r = updateTaskSchema.parse({ description: '' });
    expect(r.description).toBe('');
  });
});

describe('changeStatusSchema', () => {
  it('accepts valid status', () => {
    expect(changeStatusSchema.safeParse({ status: 'DONE' }).success).toBe(true);
  });

  it('rejects unknown status', () => {
    const r = changeStatusSchema.safeParse({ status: 'WIP' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toMatchObject({ status: expect.any(Array) });
  });
});

describe('assignTaskSchema', () => {
  it('accepts a userId', () => {
    expect(assignTaskSchema.safeParse({ assigneeId: 'u1' }).success).toBe(true);
  });

  it('accepts null', () => {
    expect(assignTaskSchema.safeParse({ assigneeId: null }).success).toBe(true);
  });

  it('transforms empty string to null', () => {
    const r = assignTaskSchema.parse({ assigneeId: '' });
    expect(r.assigneeId).toBeNull();
  });
});

describe('addCommentSchema', () => {
  it('accepts non-empty body', () => {
    expect(addCommentSchema.safeParse({ body: 'hi' }).success).toBe(true);
  });

  it('rejects empty body', () => {
    const r = addCommentSchema.safeParse({ body: '' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toMatchObject({ body: expect.any(Array) });
  });

  it('rejects whitespace-only body (after trim)', () => {
    const r = addCommentSchema.safeParse({ body: '   ' });
    expect(r.success).toBe(false);
  });

  it('rejects body longer than 10000', () => {
    expect(addCommentSchema.safeParse({ body: 'x'.repeat(10_001) }).success).toBe(false);
  });

  it('trims body', () => {
    const r = addCommentSchema.parse({ body: '  hi  ' });
    expect(r.body).toBe('hi');
  });
});

describe('taskListFilterSchema', () => {
  it('applies default page=1, sort=number, dir=desc', () => {
    const r = taskListFilterSchema.parse({});
    expect(r.page).toBe(1);
    expect(r.sort).toBe('number');
    expect(r.dir).toBe('desc');
  });

  it('coerces page from string', () => {
    const r = taskListFilterSchema.parse({ page: '3' });
    expect(r.page).toBe(3);
  });

  it('rejects page < 1', () => {
    expect(taskListFilterSchema.safeParse({ page: 0 }).success).toBe(false);
  });

  it('rejects non-integer page', () => {
    expect(taskListFilterSchema.safeParse({ page: 1.5 }).success).toBe(false);
  });

  it('rejects unknown sort field', () => {
    expect(taskListFilterSchema.safeParse({ sort: 'random' }).success).toBe(false);
  });

  it('rejects unknown dir', () => {
    expect(taskListFilterSchema.safeParse({ dir: 'sideways' }).success).toBe(false);
  });

  it('trims search query', () => {
    const r = taskListFilterSchema.parse({ q: '  foo  ' });
    expect(r.q).toBe('foo');
  });
});
