import { describe, it, expect } from 'vitest';
import { expandRussianName } from './aiHarvest';

/**
 * `expandRussianName` is the only piece of name-matching logic we
 * trust to be deterministic. Misroutes are dangerous (work assigned
 * to the wrong person), so we pin the table behaviour here.
 *
 * The contract:
 *   - input full name → echoes back unchanged
 *   - input diminutive → adds full-name prefix(es) to the set
 *   - input unknown → echoes back unchanged (no false expansions)
 *   - the original input is ALWAYS present in the result
 */

describe('expandRussianName', () => {
  it('echoes a full name unchanged', () => {
    expect(expandRussianName('Сергей')).toEqual(['Сергей']);
  });

  it('expands a diminutive to all known full-name prefixes', () => {
    const out = expandRussianName('Катя');
    expect(out).toContain('Катя');
    expect(out).toContain('Екатерина');
  });

  it.each([
    ['Дима', 'Дмитрий'],
    ['Лёня', 'Леонид'],
    ['Леня', 'Леонид'],
    ['Маша', 'Мария'],
    ['Миша', 'Михаил'],
    ['Лёша', 'Алексей'],
    ['Настя', 'Анастасия'],
    ['Аня', 'Анна'],
    ['Витя', 'Виктор'],
    ['Вика', 'Виктория'],
    ['Лена', 'Елена'],
  ])('"%s" expands to include "%s"', (dim, full) => {
    expect(expandRussianName(dim)).toContain(full);
  });

  it('multi-alternative entries return all alternatives (Наташа → Наталья + Наталия)', () => {
    const out = expandRussianName('Наташа');
    expect(out).toContain('Наталья');
    expect(out).toContain('Наталия');
  });

  it('case-insensitive: "катя" expands the same way as "Катя"', () => {
    const lc = expandRussianName('катя');
    expect(lc).toContain('катя');
    expect(lc).toContain('Екатерина');
  });

  it('whitespace is trimmed', () => {
    expect(expandRussianName('  Катя  ')).toEqual(
      expect.arrayContaining(['Катя', 'Екатерина']),
    );
  });

  it('empty / whitespace-only input returns empty array', () => {
    expect(expandRussianName('')).toEqual([]);
    expect(expandRussianName('   ')).toEqual([]);
  });

  it('an unknown name (not in table, not a known diminutive) echoes back ONLY itself', () => {
    // The whole point of this helper: never guess. "Гена" is a real
    // diminutive (for Геннадий) but isn't in the table — we'd rather
    // miss than misroute.
    expect(expandRussianName('Зокеръ')).toEqual(['Зокеръ']);
  });

  it('a diminutive that is also a valid name prefix does not duplicate', () => {
    // Sanity: the result set uses Set semantics — no duplicates.
    const out = expandRussianName('Сергей');
    const unique = [...new Set(out)];
    expect(out.length).toBe(unique.length);
  });
});
