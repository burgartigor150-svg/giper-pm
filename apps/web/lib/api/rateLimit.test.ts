import { describe, it, expect } from 'vitest';
import { clientIp } from './rateLimit';

function reqWith(headers: Record<string, string>): Request {
  return new Request('http://test.local/', { headers });
}

describe('clientIp', () => {
  it('takes the first hop of X-Forwarded-For', () => {
    expect(clientIp(reqWith({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' }))).toBe(
      '203.0.113.7',
    );
  });

  it('trims whitespace around the first hop', () => {
    expect(clientIp(reqWith({ 'x-forwarded-for': '  198.51.100.4  , 10.0.0.1' }))).toBe(
      '198.51.100.4',
    );
  });

  it('falls back to X-Real-IP when XFF is absent', () => {
    expect(clientIp(reqWith({ 'x-real-ip': '192.0.2.55' }))).toBe('192.0.2.55');
  });

  it('returns "unknown" when no IP header is present', () => {
    expect(clientIp(reqWith({}))).toBe('unknown');
  });

  it('falls back to X-Real-IP when XFF is empty/blank', () => {
    expect(clientIp(reqWith({ 'x-forwarded-for': '   ', 'x-real-ip': '192.0.2.9' }))).toBe(
      '192.0.2.9',
    );
  });
});
