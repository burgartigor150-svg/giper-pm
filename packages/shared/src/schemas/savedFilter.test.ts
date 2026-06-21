import { describe, it, expect } from 'vitest';
import {
  normalizeFilterQuery,
  savedFilterQuerySchema,
  createSavedFilterSchema,
  MAX_SAVED_FILTER_QUERY,
} from './savedFilter';

describe('normalizeFilterQuery', () => {
  it('drops page + empty params and sorts keys for order-independent equality', () => {
    const a = normalizeFilterQuery('priority=HIGH&q=foo&page=3');
    const b = normalizeFilterQuery('q=foo&priority=HIGH');
    expect(a).toBe('priority=HIGH&q=foo');
    expect(a).toBe(b); // order-independent
  });

  it('strips a leading "?" and empty values', () => {
    expect(normalizeFilterQuery('?q=&priority=HIGH')).toBe('priority=HIGH');
  });

  it('rejects unknown param keys (fail closed)', () => {
    expect(normalizeFilterQuery('evil=1')).toBeNull();
    expect(normalizeFilterQuery('priority=HIGH&evil=1')).toBeNull();
  });

  it('rejects an over-long query', () => {
    expect(normalizeFilterQuery('q=' + 'x'.repeat(MAX_SAVED_FILTER_QUERY))).toBeNull();
  });

  it('accepts every supported dimension', () => {
    const norm = normalizeFilterQuery(
      'type=BUG&dueWithin=7&reviewer=me&tagIds=a,b&assigneeId=u1&status=TODO&sort=number&dir=asc&onlyMine=1&sprintId=s1',
    );
    expect(norm).not.toBeNull();
    expect(norm).toContain('type=BUG');
    expect(norm).toContain('reviewer=me');
  });

  it('normalizes to a stable string regardless of input param order', () => {
    expect(normalizeFilterQuery('dir=asc&sort=number')).toBe(
      normalizeFilterQuery('sort=number&dir=asc'),
    );
  });
});

describe('savedFilterQuerySchema', () => {
  it('transforms a valid query to its normalized form', () => {
    const r = savedFilterQuerySchema.safeParse('q=foo&page=2&priority=HIGH');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe('priority=HIGH&q=foo');
  });

  it('rejects a query with an unknown key', () => {
    expect(savedFilterQuerySchema.safeParse('boom=1').success).toBe(false);
  });
});

describe('createSavedFilterSchema', () => {
  const base = { projectKey: 'TEST', scope: 'BOARD' as const, query: 'priority=HIGH' };

  it('rejects a name shorter than 2 chars', () => {
    expect(createSavedFilterSchema.safeParse({ ...base, name: 'x' }).success).toBe(false);
  });

  it('rejects a name longer than 80 chars', () => {
    expect(createSavedFilterSchema.safeParse({ ...base, name: 'x'.repeat(81) }).success).toBe(false);
  });

  it('defaults isShared/isDefault to false and normalizes the query', () => {
    const r = createSavedFilterSchema.safeParse({ ...base, name: 'My filter', query: 'q=foo&page=9' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.isShared).toBe(false);
      expect(r.data.isDefault).toBe(false);
      expect(r.data.query).toBe('q=foo');
    }
  });

  it('rejects an invalid scope', () => {
    expect(createSavedFilterSchema.safeParse({ ...base, scope: 'NOPE', name: 'ok' }).success).toBe(false);
  });
});
