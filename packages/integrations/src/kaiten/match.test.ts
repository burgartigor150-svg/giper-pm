import { describe, it, expect } from 'vitest';
import {
  normalizeTitle,
  titleSimilarity,
  classifyMatch,
  bestMatch,
  prepareCandidates,
  bestMatchPrepared,
} from './match';

describe('normalizeTitle', () => {
  it('strips key/number/bracket prefixes, lowercases, folds ё, drops punctuation', () => {
    expect(normalizeTitle('PROJ-12: Починить логин')).toBe('починить логин');
    expect(normalizeTitle('#45 Починить, логин!')).toBe('починить логин');
    expect(normalizeTitle('[BUG] Чёткий вход')).toBe('четкий вход');
    expect(normalizeTitle('1) Сделать отчёт')).toBe('сделать отчет');
  });
});

describe('titleSimilarity', () => {
  it('identical normalized titles → 1', () => {
    expect(titleSimilarity('Починить логин', 'починить, логин!')).toBe(1);
    expect(titleSimilarity('PROJ-1: Отчёт за май', '#9 Отчет за май')).toBe(1);
  });
  it('word-order / minor differences score high', () => {
    expect(titleSimilarity('Логин чинить срочно', 'Срочно чинить логин')).toBeGreaterThan(0.9);
  });
  it('unrelated titles score low', () => {
    expect(titleSimilarity('Починить логин', 'Дизайн главной страницы')).toBeLessThan(0.4);
  });
  it('empty / one-word edge cases', () => {
    expect(titleSimilarity('', 'что-то')).toBe(0);
    expect(titleSimilarity('логин', 'логин')).toBe(1);
  });
});

describe('classifyMatch + bestMatch', () => {
  it('classifies by threshold', () => {
    expect(classifyMatch(0.95)).toBe('auto');
    expect(classifyMatch(0.7)).toBe('suggest');
    expect(classifyMatch(0.2)).toBe('none');
  });
  it('bestMatch picks the highest-scoring candidate above the suggest floor', () => {
    const m = bestMatch('Починить логин на проде', [
      { id: 'b1', title: 'Дизайн лендинга' },
      { id: 'b2', title: 'PROJ-3: Починить логин на проде' },
      { id: 'b3', title: 'Логин чуть-чуть' },
    ]);
    expect(m?.id).toBe('b2');
    expect(m?.confidence).toBe('auto');
  });
  it('returns null when nothing clears the suggest threshold', () => {
    expect(bestMatch('Полностью иное', [{ id: 'b1', title: 'Совсем другое тут' }])).toBeNull();
  });
});

describe('bestMatchPrepared (precomputed candidates)', () => {
  const cands = [
    { id: 'b1', title: 'Дизайн лендинга' },
    { id: 'b2', title: 'PROJ-3: Починить логин на проде' },
    { id: 'b3', title: 'Логин чуть-чуть' },
  ];
  const prepared = prepareCandidates(cands);

  it('agrees with bestMatch on id + confidence', () => {
    const a = bestMatch('Починить логин на проде', cands);
    const b = bestMatchPrepared('Починить логин на проде', prepared);
    expect(b?.id).toBe(a?.id);
    expect(b?.confidence).toBe(a?.confidence);
    expect(b?.id).toBe('b2');
    expect(b?.confidence).toBe('auto');
  });

  it('returns null below the suggest floor', () => {
    expect(bestMatchPrepared('Полностью иное', prepareCandidates([{ id: 'x', title: 'Совсем другое тут' }]))).toBeNull();
  });
});
