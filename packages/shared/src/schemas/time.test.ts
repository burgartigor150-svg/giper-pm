import { describe, it, expect } from 'vitest';
import {
  logTimeSchema,
  editTimeEntrySchema,
  timeRangeSchema,
  timeListFilterSchema,
  timeSourceSchema,
  timeFlagSchema,
} from './time';

describe('timeSourceSchema', () => {
  it('exposes 8 sources', () => {
    expect(timeSourceSchema.options).toEqual([
      'MANUAL_TIMER',
      'MANUAL_FORM',
      'TELEGRAM',
      'AUTO_AGENT',
      'AUTO_BROWSER',
      'DIGITAL_GIT',
      'DIGITAL_CALENDAR',
      'DIGITAL_SLACK',
    ]);
  });

  it('rejects unknown source', () => {
    expect(timeSourceSchema.safeParse('FOO').success).toBe(false);
  });
});

describe('timeFlagSchema', () => {
  it('exposes 5 flags', () => {
    expect(timeFlagSchema.options).toEqual([
      'REVIEW_NEEDED',
      'GAP_DETECTED',
      'OVERLAPPING',
      'EXCESSIVE',
      'IDLE_LOGGED',
    ]);
  });
});

describe('timeRangeSchema', () => {
  it('defaults to "week"', () => {
    expect(timeRangeSchema.parse(undefined)).toBe('week');
  });

  it('accepts the four ranges', () => {
    for (const v of ['today', 'week', 'month', 'custom']) {
      expect(timeRangeSchema.parse(v)).toBe(v);
    }
  });

  it('rejects unknown range', () => {
    expect(timeRangeSchema.safeParse('year').success).toBe(false);
  });
});

describe('logTimeSchema', () => {
  const startedAt = '2026-05-01T10:00:00Z';
  const endedAt = '2026-05-01T11:00:00Z';

  it('parses minimal valid input', () => {
    const r = logTimeSchema.safeParse({ startedAt, endedAt });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.startedAt).toBeInstanceOf(Date);
      expect(r.data.endedAt).toBeInstanceOf(Date);
      expect(r.data.taskId).toBeUndefined();
      expect(r.data.note).toBeUndefined();
    }
  });

  it('accepts Date objects', () => {
    const r = logTimeSchema.safeParse({
      startedAt: new Date('2026-05-01T10:00:00Z'),
      endedAt: new Date('2026-05-01T11:00:00Z'),
    });
    expect(r.success).toBe(true);
  });

  it('rejects when endedAt <= startedAt', () => {
    const r = logTimeSchema.safeParse({ startedAt: endedAt, endedAt: startedAt });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors).toMatchObject({ endedAt: expect.any(Array) });
    }
  });

  it('rejects equal startedAt and endedAt', () => {
    const r = logTimeSchema.safeParse({ startedAt, endedAt: startedAt });
    expect(r.success).toBe(false);
  });

  it('rejects invalid date string', () => {
    const r = logTimeSchema.safeParse({ startedAt: 'totally bogus xxx', endedAt });
    expect(r.success).toBe(false);
  });

  it('rejects empty startedAt string', () => {
    const r = logTimeSchema.safeParse({ startedAt: '', endedAt });
    expect(r.success).toBe(false);
  });

  it('transforms empty taskId to undefined', () => {
    const r = logTimeSchema.parse({ startedAt, endedAt, taskId: '' });
    expect(r.taskId).toBeUndefined();
  });

  it('coerces empty-string note to undefined', () => {
    const r = logTimeSchema.parse({ startedAt, endedAt, note: '' });
    expect(r.note).toBeUndefined();
  });

  it('coerces whitespace-only note to undefined', () => {
    const r = logTimeSchema.parse({ startedAt, endedAt, note: '   ' });
    expect(r.note).toBeUndefined();
  });

  it('omits note entirely when not provided', () => {
    const r = logTimeSchema.parse({ startedAt, endedAt });
    expect(r.note).toBeUndefined();
  });

  it('trims note', () => {
    const r = logTimeSchema.parse({ startedAt, endedAt, note: '  hello  ' });
    expect(r.note).toBe('hello');
  });

  it('rejects note longer than 2000', () => {
    const r = logTimeSchema.safeParse({ startedAt, endedAt, note: 'x'.repeat(2001) });
    expect(r.success).toBe(false);
  });

  it('accepts taskId', () => {
    const r = logTimeSchema.parse({ startedAt, endedAt, taskId: 't-1' });
    expect(r.taskId).toBe('t-1');
  });
});

describe('editTimeEntrySchema', () => {
  const startedAt = '2026-05-01T10:00:00Z';
  const endedAt = '2026-05-01T11:00:00Z';

  it('parses minimal valid input', () => {
    expect(editTimeEntrySchema.safeParse({ startedAt, endedAt }).success).toBe(true);
  });

  it('accepts taskId=null', () => {
    const r = editTimeEntrySchema.safeParse({ startedAt, endedAt, taskId: null });
    expect(r.success).toBe(true);
  });

  it('transforms empty taskId to null', () => {
    const r = editTimeEntrySchema.parse({ startedAt, endedAt, taskId: '' });
    expect(r.taskId).toBeNull();
  });

  it('rejects when endedAt <= startedAt', () => {
    const r = editTimeEntrySchema.safeParse({ startedAt: endedAt, endedAt: startedAt });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors).toMatchObject({ endedAt: expect.any(Array) });
    }
  });
});

describe('timeListFilterSchema', () => {
  it('applies default range "week"', () => {
    const r = timeListFilterSchema.parse({});
    expect(r.range).toBe('week');
  });

  it('accepts from/to in YYYY-MM-DD', () => {
    const r = timeListFilterSchema.parse({ range: 'custom', from: '2026-05-01', to: '2026-05-07' });
    expect(r.from).toBe('2026-05-01');
    expect(r.to).toBe('2026-05-07');
  });

  it('rejects bad from format', () => {
    const r = timeListFilterSchema.safeParse({ from: '01/05/2026' });
    expect(r.success).toBe(false);
  });

  it('rejects bad to format', () => {
    const r = timeListFilterSchema.safeParse({ to: '2026/05/01' });
    expect(r.success).toBe(false);
  });

  it('accepts empty object', () => {
    expect(timeListFilterSchema.safeParse({}).success).toBe(true);
  });
});
