import { describe, it, expect } from 'vitest';
import { evaluateFormula } from './formula';

const vals: Record<string, number> = { Цена: 100, 'Кол-во': 3, Скидка: 10 };
const get = (n: string): number | null => (n in vals ? vals[n]! : null);

describe('evaluateFormula', () => {
  it('basic arithmetic with precedence', () => {
    expect(evaluateFormula('2 + 3 * 4', get)).toBe(14);
    expect(evaluateFormula('(2 + 3) * 4', get)).toBe(20);
    expect(evaluateFormula('10 / 4', get)).toBe(2.5);
  });

  it('resolves {Column} references', () => {
    expect(evaluateFormula('{Цена} * {Кол-во}', get)).toBe(300);
    expect(evaluateFormula('{Цена} * {Кол-во} - {Скидка}', get)).toBe(290);
    expect(evaluateFormula('{Цена} * (1 - {Скидка} / 100)', get)).toBe(90);
  });

  it('returns null on missing ref, div-by-zero, or bad input', () => {
    expect(evaluateFormula('{Нет}', get)).toBeNull();
    expect(evaluateFormula('{Цена} / 0', get)).toBeNull();
    expect(evaluateFormula('2 +', get)).toBeNull();
    expect(evaluateFormula('(1 + 2', get)).toBeNull();
    expect(evaluateFormula('', get)).toBeNull();
    expect(evaluateFormula('alert(1)', get)).toBeNull();
  });

  it('handles unary minus / plus', () => {
    expect(evaluateFormula('-5', get)).toBe(-5);
    expect(evaluateFormula('(-5)', get)).toBe(-5);
    expect(evaluateFormula('{Цена} * -1', get)).toBe(-100);
    expect(evaluateFormula('-{Скидка}', get)).toBe(-10);
    expect(evaluateFormula('{Цена} + -{Скидка}', get)).toBe(90);
    expect(evaluateFormula('3 - -2', get)).toBe(5);
    expect(evaluateFormula('+7', get)).toBe(7);
    expect(evaluateFormula('-2 ^ 2', get)).toBeNull(); // ^ unsupported
  });

  it('rejects malformed multi-dot numbers instead of truncating', () => {
    expect(evaluateFormula('1.2.3', get)).toBeNull();
    expect(evaluateFormula('3..5', get)).toBeNull();
    expect(evaluateFormula('1.2.3 + 1', get)).toBeNull();
    expect(evaluateFormula('.5 + .5', get)).toBe(1); // leading-dot decimals still valid
  });
});
