import { describe, it, expect } from 'vitest';
import { normalizeKaitenDomain, kaitenBaseUrl } from './client';

describe('normalizeKaitenDomain (SSRF guard)', () => {
  it('canonicalizes valid inputs to <slug>.kaiten.ru', () => {
    expect(normalizeKaitenDomain('acme')).toBe('acme.kaiten.ru');
    expect(normalizeKaitenDomain('acme.kaiten.ru')).toBe('acme.kaiten.ru');
    expect(normalizeKaitenDomain('https://acme.kaiten.ru/')).toBe('acme.kaiten.ru');
    expect(normalizeKaitenDomain('  ACME.kaiten.ru  ')).toBe('acme.kaiten.ru');
    expect(normalizeKaitenDomain('https://acme.kaiten.ru/api/latest?x=1')).toBe('acme.kaiten.ru');
  });
  it('rejects non-kaiten and malicious hosts', () => {
    expect(normalizeKaitenDomain('evil.com')).toBeNull();
    expect(normalizeKaitenDomain('acme.kaiten.ru.evil.com')).toBeNull();
    expect(normalizeKaitenDomain('169.254.169.254')).toBeNull();
    expect(normalizeKaitenDomain('acme.kaiten.ru@evil.com')).toBeNull();
    expect(normalizeKaitenDomain('')).toBeNull();
    expect(normalizeKaitenDomain('-bad')).toBeNull();
  });
  it('a bare word can never escape .kaiten.ru (no SSRF foothold)', () => {
    // Even "localhost" becomes localhost.kaiten.ru — a public Kaiten host, not the loopback.
    expect(normalizeKaitenDomain('localhost')).toBe('localhost.kaiten.ru');
  });
  it('kaitenBaseUrl throws on invalid domain', () => {
    expect(kaitenBaseUrl('acme')).toBe('https://acme.kaiten.ru/api/latest');
    expect(() => kaitenBaseUrl('evil.com')).toThrow();
  });
});
