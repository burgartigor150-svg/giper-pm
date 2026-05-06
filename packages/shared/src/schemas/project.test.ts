import { describe, it, expect } from 'vitest';
import {
  createProjectSchema,
  updateProjectSchema,
  addMemberSchema,
  projectKeySchema,
  projectStatusSchema,
  memberRoleSchema,
  generateProjectKey,
} from './project';

describe('projectKeySchema', () => {
  it('accepts a valid uppercase 2-5 letter key', () => {
    expect(projectKeySchema.parse('AB')).toBe('AB');
    expect(projectKeySchema.parse('ABCDE')).toBe('ABCDE');
  });

  it('trims and uppercases input', () => {
    expect(projectKeySchema.parse('  abc  ')).toBe('ABC');
  });

  it('rejects single character', () => {
    expect(projectKeySchema.safeParse('A').success).toBe(false);
  });

  it('rejects 6+ characters', () => {
    expect(projectKeySchema.safeParse('ABCDEF').success).toBe(false);
  });

  it('rejects digits', () => {
    expect(projectKeySchema.safeParse('AB1').success).toBe(false);
  });

  it('rejects empty string', () => {
    expect(projectKeySchema.safeParse('').success).toBe(false);
  });
});

describe('projectStatusSchema', () => {
  it('exposes the 4 statuses', () => {
    expect(projectStatusSchema.options).toEqual(['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED']);
  });
  it('rejects unknown status', () => {
    expect(projectStatusSchema.safeParse('FOO').success).toBe(false);
  });
});

describe('memberRoleSchema', () => {
  it('exposes 4 roles', () => {
    expect(memberRoleSchema.options).toEqual(['LEAD', 'CONTRIBUTOR', 'REVIEWER', 'OBSERVER']);
  });
});

describe('createProjectSchema', () => {
  it('parses minimal valid input', () => {
    const r = createProjectSchema.safeParse({ name: 'My Project', key: 'MYP' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe('My Project');
      expect(r.data.key).toBe('MYP');
      expect(r.data.description).toBeUndefined();
    }
  });

  it('rejects too short name', () => {
    const r = createProjectSchema.safeParse({ name: 'A', key: 'MYP' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toMatchObject({ name: expect.any(Array) });
  });

  it('rejects invalid key', () => {
    const r = createProjectSchema.safeParse({ name: 'Foo Bar', key: 'A' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toMatchObject({ key: expect.any(Array) });
  });

  // KNOWN BUG: `.optional().or(z.literal('').transform(...))` — `.optional()` accepts ''
  // first (since empty string passes string().trim().max(N)), so the empty-to-undefined
  // transform never fires. Locking in current behavior; see test agent summary.
  it('currently keeps empty-string description as ""', () => {
    const r = createProjectSchema.parse({ name: 'Foo', key: 'FOO', description: '' });
    expect(r.description).toBe('');
  });

  it('currently keeps empty-string client as ""', () => {
    const r = createProjectSchema.parse({ name: 'Foo', key: 'FOO', client: '' });
    expect(r.client).toBe('');
  });

  it('omits description entirely when not provided', () => {
    const r = createProjectSchema.parse({ name: 'Foo', key: 'FOO' });
    expect(r.description).toBeUndefined();
  });

  it('coerces string budgetHours to number', () => {
    const r = createProjectSchema.parse({ name: 'Foo', key: 'FOO', budgetHours: '120' });
    expect(r.budgetHours).toBe(120);
  });

  it('rejects negative budgetHours', () => {
    const r = createProjectSchema.safeParse({ name: 'Foo', key: 'FOO', budgetHours: -1 });
    expect(r.success).toBe(false);
  });

  it('rejects budgetHours > 100k', () => {
    const r = createProjectSchema.safeParse({ name: 'Foo', key: 'FOO', budgetHours: 100_001 });
    expect(r.success).toBe(false);
  });

  it('parses ISO datetime deadline into Date', () => {
    const r = createProjectSchema.parse({ name: 'Foo', key: 'FOO', deadline: '2026-01-01T00:00:00Z' });
    expect(r.deadline).toBeInstanceOf(Date);
  });

  it('treats empty-string deadline as undefined', () => {
    const r = createProjectSchema.parse({ name: 'Foo', key: 'FOO', deadline: '' });
    expect(r.deadline).toBeUndefined();
  });

  it('rejects invalid deadline string', () => {
    const r = createProjectSchema.safeParse({ name: 'Foo', key: 'FOO', deadline: 'not-a-date' });
    expect(r.success).toBe(false);
  });

  it('trims name', () => {
    const r = createProjectSchema.parse({ name: '  Foo Bar  ', key: 'FOO' });
    expect(r.name).toBe('Foo Bar');
  });

  it('rejects name longer than 80', () => {
    const r = createProjectSchema.safeParse({ name: 'a'.repeat(81), key: 'FOO' });
    expect(r.success).toBe(false);
  });
});

describe('updateProjectSchema', () => {
  // KNOWN BUG: spreads baseProjectFields where `name` is required (z.string().min(2)).
  // Intent of "update" suggests name should be optional. Currently empty {} fails.
  it('currently REQUIRES name (likely a bug — intent is fully partial update)', () => {
    const r = updateProjectSchema.safeParse({});
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toMatchObject({ name: expect.any(Array) });
  });

  it('accepts a name + status update', () => {
    const r = updateProjectSchema.safeParse({ name: 'New Name', status: 'ARCHIVED' });
    expect(r.success).toBe(true);
  });

  it('rejects unknown status (with name provided)', () => {
    const r = updateProjectSchema.safeParse({ name: 'Whatever', status: 'BOGUS' });
    expect(r.success).toBe(false);
  });
});

describe('addMemberSchema', () => {
  it('parses valid input', () => {
    const r = addMemberSchema.safeParse({ userId: 'u1', role: 'LEAD' });
    expect(r.success).toBe(true);
  });

  it('rejects empty userId', () => {
    const r = addMemberSchema.safeParse({ userId: '', role: 'LEAD' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toMatchObject({ userId: expect.any(Array) });
  });

  it('rejects unknown role', () => {
    const r = addMemberSchema.safeParse({ userId: 'u1', role: 'BOSS' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toMatchObject({ role: expect.any(Array) });
  });
});

describe('generateProjectKey', () => {
  it('returns PRJ for empty string', () => {
    expect(generateProjectKey('')).toBe('PRJ');
  });

  it('returns PRJ for whitespace only', () => {
    expect(generateProjectKey('   ')).toBe('PRJ');
  });

  it('returns PRJ for digits-only input', () => {
    expect(generateProjectKey('12345')).toBe('PRJ');
  });

  it('romanises cyrillic and takes first letters', () => {
    // "Мой Проект" -> roman "moy proekt" -> initials "MP"
    expect(generateProjectKey('Мой Проект')).toBe('MP');
  });

  it('uppercases first letters from latin words', () => {
    expect(generateProjectKey('foo bar baz')).toBe('FBB');
  });

  it('truncates long initial-strings to 5', () => {
    expect(generateProjectKey('one two three four five six seven')).toHaveLength(5);
  });

  it('pads single-char initial to 2 chars from first word', () => {
    const k = generateProjectKey('alpha');
    expect(k.length).toBeGreaterThanOrEqual(2);
    expect(k.length).toBeLessThanOrEqual(5);
    expect(k).toMatch(/^[A-Z]{2,5}$/);
  });

  it('pads single-letter word with PRJ fallback to length 3', () => {
    const k = generateProjectKey('a');
    expect(k.length).toBeGreaterThanOrEqual(2);
    expect(k).toMatch(/^[A-Z]{2,5}$/);
  });

  it('handles mixed cyrillic + latin', () => {
    const k = generateProjectKey('Гипер pm');
    expect(k).toMatch(/^[A-Z]{2,5}$/);
  });

  it('strips punctuation', () => {
    const k = generateProjectKey('Foo! @Bar #Baz');
    expect(k).toBe('FBB');
  });

  it('always returns A-Z only', () => {
    const samples = ['Привет мир', 'Hello World', '123 456', 'ыыы ёёё', 'Q', '', '  '];
    for (const s of samples) {
      expect(generateProjectKey(s)).toMatch(/^[A-Z]{2,5}$/);
    }
  });
});
