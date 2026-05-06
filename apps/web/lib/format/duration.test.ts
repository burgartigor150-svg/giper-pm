import { describe, it, expect } from 'vitest';
import { formatMinutes, minutesToHours } from './duration';

describe('formatMinutes', () => {
  it('returns 0м for 0 / negative / NaN', () => {
    expect(formatMinutes(0)).toBe('0м');
    expect(formatMinutes(-10)).toBe('0м');
    expect(formatMinutes(0.4)).toBe('0м');
  });
  it('formats minutes only when under an hour', () => {
    expect(formatMinutes(1)).toBe('1м');
    expect(formatMinutes(45)).toBe('45м');
    expect(formatMinutes(59)).toBe('59м');
  });
  it('formats hours only when whole hours', () => {
    expect(formatMinutes(60)).toBe('1ч');
    expect(formatMinutes(180)).toBe('3ч');
  });
  it('formats hours + minutes when both', () => {
    expect(formatMinutes(61)).toBe('1ч 1м');
    expect(formatMinutes(125)).toBe('2ч 5м');
    expect(formatMinutes(479)).toBe('7ч 59м');
  });
});

describe('minutesToHours', () => {
  it('formats with 1 decimal place', () => {
    expect(minutesToHours(0)).toBe('0.0');
    expect(minutesToHours(30)).toBe('0.5');
    expect(minutesToHours(60)).toBe('1.0');
    expect(minutesToHours(90)).toBe('1.5');
    expect(minutesToHours(75)).toBe('1.3');
  });
});
