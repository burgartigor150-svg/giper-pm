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

  it('priority/type enums + page size', () => {
    expect(taskPrioritySchema.options).toEqual(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
    expect(taskTypeSchema.options).toEqual(['TASK', 'BUG', 'FEATURE', 'EPIC', 'CHORE']);
    expect(TASKS_PAGE_SIZE).toBe(50);
  });
});

describe('tagsSchema', () => {
  it('defaults to empty array when undefined; accepts array; splits CSV', () => {
    expect(tagsSchema.parse(undefined)).toEqual([]);
    expect(tagsSchema.parse(['a', 'b'])).toEqual(['a', 'b']);
    expect(tagsSchema.parse('foo, bar,baz')).toEqual(['foo', 'bar', 'baz']);
    expect(tagsSchema.parse('foo,,bar,')).toEqual(['foo', 'bar']);
  });

  it('rejects too-long entry and empty entry in array', () => {
    expect(tagsSchema.safeParse(['x'.repeat(33)]).success).toBe(false);
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

  it('rejects bad projectKey (path: projectKey)', () => {
    const r = createTaskSchema.safeParse({ ...valid, projectKey: 'A' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toMatchObject({ projectKey: expect.any(Array) });
  });

  it('rejects too-short / too-long title (path: title)', () => {
    const tooShort = createTaskSchema.safeParse({ ...valid, title: 'A' });
    expect(tooShort.success).toBe(false);
    if (!tooShort.success) {
      expect(tooShort.error.flatten().fieldErrors).toMatchObject({ title: expect.any(Array) });
    }
    expect(createTaskSchema.safeParse({ ...valid, title: 'a'.repeat(201) }).success).toBe(false);
  });

  it('trims title', () => {
    expect(createTaskSchema.parse({ ...valid, title: '  Hello  ' }).title).toBe('Hello');
  });

  it('coerces empty-string description to undefined', () => {
    expect(createTaskSchema.parse({ ...valid, description: '' }).description).toBeUndefined();
  });

  it('coerces whitespace-only description to undefined', () => {
    expect(createTaskSchema.parse({ ...valid, description: '   ' }).description).toBeUndefined();
  });

  it('trims description', () => {
    expect(createTaskSchema.parse({ ...valid, description: '  body  ' }).description).toBe('body');
  });

  it('omits description when not provided', () => {
    expect(createTaskSchema.parse(valid).description).toBeUndefined();
  });

  it('transforms empty assigneeId to undefined', () => {
    expect(createTaskSchema.parse({ ...valid, assigneeId: '' }).assigneeId).toBeUndefined();
  });

  it('rejects bad priority/type', () => {
    expect(createTaskSchema.safeParse({ ...valid, priority: 'INSANE' }).success).toBe(false);
    expect(createTaskSchema.safeParse({ ...valid, type: 'STORY' }).success).toBe(false);
  });

  it('coerces estimateHours, rejects negative', () => {
    expect(createTaskSchema.parse({ ...valid, estimateHours: '5.5' }).estimateHours).toBe(5.5);
    expect(createTaskSchema.safeParse({ ...valid, estimateHours: -1 }).success).toBe(false);
  });

  it('accepts dueDate in YYYY-MM-DD or ISO datetime', () => {
    expect(createTaskSchema.parse({ ...valid, dueDate: '2026-05-01' }).dueDate).toBeInstanceOf(Date);
    expect(createTaskSchema.parse({ ...valid, dueDate: '2026-05-01T12:00:00Z' }).dueDate).toBeInstanceOf(Date);
  });

  it('treats empty dueDate as undefined; rejects bad format', () => {
    expect(createTaskSchema.parse({ ...valid, dueDate: '' }).dueDate).toBeUndefined();
    expect(createTaskSchema.safeParse({ ...valid, dueDate: '01/05/2026' }).success).toBe(false);
  });

  it('parses tags as comma-separated string', () => {
    expect(createTaskSchema.parse({ ...valid, tags: 'urgent, frontend' }).tags).toEqual(['urgent', 'frontend']);
  });
});

describe('updateTaskSchema', () => {
  it('accepts empty object', () => {
    expect(updateTaskSchema.safeParse({}).success).toBe(true);
  });

  it('rejects too-short title', () => {
    expect(updateTaskSchema.safeParse({ title: 'A' }).success).toBe(false);
  });

  it('coerces empty-string description to undefined', () => {
    expect(updateTaskSchema.parse({ description: '' }).description).toBeUndefined();
  });

  it('trims description on update', () => {
    expect(updateTaskSchema.parse({ description: '  body  ' }).description).toBe('body');
  });
});

describe('changeStatusSchema', () => {
  it('accepts valid status', () => {
    expect(changeStatusSchema.safeParse({ status: 'DONE' }).success).toBe(true);
  });

  it('rejects unknown status (path: status)', () => {
    const r = changeStatusSchema.safeParse({ status: 'WIP' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toMatchObject({ status: expect.any(Array) });
  });
});

describe('assignTaskSchema', () => {
  it('accepts userId, null, and transforms empty string to null', () => {
    expect(assignTaskSchema.safeParse({ assigneeId: 'u1' }).success).toBe(true);
    expect(assignTaskSchema.safeParse({ assigneeId: null }).success).toBe(true);
    expect(assignTaskSchema.parse({ assigneeId: '' }).assigneeId).toBeNull();
  });
});

describe('addCommentSchema', () => {
  it('accepts non-empty body, trims', () => {
    expect(addCommentSchema.safeParse({ body: 'hi' }).success).toBe(true);
    expect(addCommentSchema.parse({ body: '  hi  ' }).body).toBe('hi');
  });

  it('rejects empty / whitespace-only / too long body (path: body)', () => {
    const r = addCommentSchema.safeParse({ body: '' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toMatchObject({ body: expect.any(Array) });
    expect(addCommentSchema.safeParse({ body: '   ' }).success).toBe(false);
    expect(addCommentSchema.safeParse({ body: 'x'.repeat(10_001) }).success).toBe(false);
  });
});

describe('taskListFilterSchema', () => {
  it('applies default page=1, sort=number, dir=desc', () => {
    const r = taskListFilterSchema.parse({});
    expect(r.page).toBe(1);
    expect(r.sort).toBe('number');
    expect(r.dir).toBe('desc');
  });

  it('coerces page from string; rejects <1, non-integer', () => {
    expect(taskListFilterSchema.parse({ page: '3' }).page).toBe(3);
    expect(taskListFilterSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(taskListFilterSchema.safeParse({ page: 1.5 }).success).toBe(false);
  });

  it('rejects unknown sort/dir', () => {
    expect(taskListFilterSchema.safeParse({ sort: 'random' }).success).toBe(false);
    expect(taskListFilterSchema.safeParse({ dir: 'sideways' }).success).toBe(false);
  });

  it('trims search query', () => {
    expect(taskListFilterSchema.parse({ q: '  foo  ' }).q).toBe('foo');
  });
});
