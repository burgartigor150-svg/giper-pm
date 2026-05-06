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

  it('rejects single char, 6+, digits, empty', () => {
    for (const v of ['A', 'ABCDEF', 'AB1', '']) {
      expect(projectKeySchema.safeParse(v).success).toBe(false);
    }
  });
});

describe('projectStatusSchema', () => {
  it('exposes 4 statuses and rejects unknown', () => {
    expect(projectStatusSchema.options).toEqual(['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED']);
    expect(projectStatusSchema.safeParse('FOO').success).toBe(false);
  });
});

describe('memberRoleSchema', () => {
  it('exposes 4 roles', () => {
    expect(memberRoleSchema.options).toEqual(['LEAD', 'CONTRIBUTOR', 'REVIEWER', 'OBSERVER']);
  });
});

describe('createProjectSchema', () => {
  const base = { name: 'My Project', key: 'MYP' } as const;

  it('parses minimal valid input', () => {
    const r = createProjectSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe('My Project');
      expect(r.data.key).toBe('MYP');
      expect(r.data.description).toBeUndefined();
    }
  });

  it('rejects too short name (path: name)', () => {
    const r = createProjectSchema.safeParse({ ...base, name: 'A' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toMatchObject({ name: expect.any(Array) });
  });

  it('rejects invalid key (path: key)', () => {
    const r = createProjectSchema.safeParse({ ...base, key: 'A' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toMatchObject({ key: expect.any(Array) });
  });

  it('coerces empty-string description/client to undefined', () => {
    const r = createProjectSchema.parse({ ...base, description: '', client: '' });
    expect(r.description).toBeUndefined();
    expect(r.client).toBeUndefined();
  });

  it('coerces whitespace-only description/client to undefined', () => {
    const r = createProjectSchema.parse({ ...base, description: '   ', client: '\t\n' });
    expect(r.description).toBeUndefined();
    expect(r.client).toBeUndefined();
  });

  it('trims description', () => {
    const r = createProjectSchema.parse({ ...base, description: '  hello  ' });
    expect(r.description).toBe('hello');
  });

  it('omits description entirely when not provided', () => {
    expect(createProjectSchema.parse(base).description).toBeUndefined();
  });

  it('coerces string budgetHours and rejects out-of-range', () => {
    expect(createProjectSchema.parse({ ...base, budgetHours: '120' }).budgetHours).toBe(120);
    expect(createProjectSchema.safeParse({ ...base, budgetHours: -1 }).success).toBe(false);
    expect(createProjectSchema.safeParse({ ...base, budgetHours: 100_001 }).success).toBe(false);
  });

  it('parses ISO datetime deadline into Date', () => {
    expect(createProjectSchema.parse({ ...base, deadline: '2026-01-01T00:00:00Z' }).deadline).toBeInstanceOf(Date);
  });

  it('treats empty-string deadline as undefined', () => {
    expect(createProjectSchema.parse({ ...base, deadline: '' }).deadline).toBeUndefined();
  });

  it('rejects invalid deadline string', () => {
    expect(createProjectSchema.safeParse({ ...base, deadline: 'not-a-date' }).success).toBe(false);
  });

  it('trims name', () => {
    expect(createProjectSchema.parse({ ...base, name: '  Foo Bar  ' }).name).toBe('Foo Bar');
  });

  it('rejects name longer than 80', () => {
    expect(createProjectSchema.safeParse({ ...base, name: 'a'.repeat(81) }).success).toBe(false);
  });
});

describe('updateProjectSchema', () => {
  it('accepts an empty object (every field optional)', () => {
    const r = updateProjectSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it('accepts a status-only update', () => {
    const r = updateProjectSchema.safeParse({ status: 'ARCHIVED' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.status).toBe('ARCHIVED');
  });

  it('accepts a name + status update; rejects unknown status', () => {
    expect(updateProjectSchema.safeParse({ name: 'New Name', status: 'ARCHIVED' }).success).toBe(true);
    expect(updateProjectSchema.safeParse({ name: 'Whatever', status: 'BOGUS' }).success).toBe(false);
  });

  it('still rejects an explicit too-short name', () => {
    const r = updateProjectSchema.safeParse({ name: 'a' });
    expect(r.success).toBe(false);
  });
});

describe('addMemberSchema', () => {
  it('parses valid input', () => {
    expect(addMemberSchema.safeParse({ userId: 'u1', role: 'LEAD' }).success).toBe(true);
  });

  it('rejects empty userId (path: userId)', () => {
    const r = addMemberSchema.safeParse({ userId: '', role: 'LEAD' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toMatchObject({ userId: expect.any(Array) });
  });

  it('rejects unknown role (path: role)', () => {
    const r = addMemberSchema.safeParse({ userId: 'u1', role: 'BOSS' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toMatchObject({ role: expect.any(Array) });
  });
});

describe('generateProjectKey', () => {
  it('returns PRJ for empty / whitespace / digits-only', () => {
    expect(generateProjectKey('')).toBe('PRJ');
    expect(generateProjectKey('   ')).toBe('PRJ');
    expect(generateProjectKey('12345')).toBe('PRJ');
  });

  it('romanises cyrillic and takes first letters', () => {
    // "Мой Проект" -> roman "moy proekt" -> initials "MP"
    expect(generateProjectKey('Мой Проект')).toBe('MP');
  });

  it('uppercases first letters from latin words', () => {
    expect(generateProjectKey('foo bar baz')).toBe('FBB');
  });

  it('truncates long initial-strings to 5 chars', () => {
    expect(generateProjectKey('one two three four five six seven')).toHaveLength(5);
  });

  it('pads single-word inputs into 2-5 char A-Z key', () => {
    for (const s of ['alpha', 'a', 'Q']) {
      const k = generateProjectKey(s);
      expect(k).toMatch(/^[A-Z]{2,5}$/);
    }
  });

  it('handles mixed cyrillic + latin', () => {
    expect(generateProjectKey('Гипер pm')).toMatch(/^[A-Z]{2,5}$/);
  });

  it('strips punctuation', () => {
    expect(generateProjectKey('Foo! @Bar #Baz')).toBe('FBB');
  });

  it('always returns A-Z only', () => {
    for (const s of ['Привет мир', 'Hello World', '123 456', 'ыыы ёёё', 'Q', '', '  ']) {
      expect(generateProjectKey(s)).toMatch(/^[A-Z]{2,5}$/);
    }
  });
});
