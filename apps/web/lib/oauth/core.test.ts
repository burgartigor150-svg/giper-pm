import { createHash } from 'node:crypto';
import { describe, it, expect, beforeAll } from 'vitest';
import {
  isAllowedRedirectUri,
  signConsentToken,
  verifyConsentToken,
  verifyPkceS256,
  type ConsentBinding,
} from './core';

function s256(verifier: string): string {
  return createHash('sha256')
    .update(verifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

beforeAll(() => {
  process.env.AUTH_SECRET = 'unit-test-secret-do-not-use-in-prod';
});

const binding: ConsentBinding = {
  userId: 'user_1',
  clientId: 'gpc_client',
  redirectUri: 'https://app.example.com/cb',
  codeChallenge: 'abc123challenge',
  scope: 'mcp',
  state: 'xyz',
};

describe('isAllowedRedirectUri', () => {
  it('accepts https URIs', () => {
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true);
  });

  it('accepts http only for loopback hosts', () => {
    expect(isAllowedRedirectUri('http://localhost:8080/cb')).toBe(true);
    expect(isAllowedRedirectUri('http://127.0.0.1/cb')).toBe(true);
    expect(isAllowedRedirectUri('http://[::1]:3000/cb')).toBe(true);
  });

  it('rejects http to a remote host (cleartext exfiltration)', () => {
    expect(isAllowedRedirectUri('http://evil.example.com/cb')).toBe(false);
    expect(isAllowedRedirectUri('http://attacker.test')).toBe(false);
  });

  it('rejects non-http(s) schemes and garbage', () => {
    expect(isAllowedRedirectUri('javascript:alert(1)')).toBe(false);
    expect(isAllowedRedirectUri('ftp://host/cb')).toBe(false);
    expect(isAllowedRedirectUri('not a url')).toBe(false);
  });
});

describe('consent token', () => {
  it('round-trips a valid token for the exact binding', () => {
    const token = signConsentToken(binding);
    expect(verifyConsentToken(token, binding)).toBe(true);
  });

  it('rejects a token when the user id differs (CSRF / forged victim)', () => {
    const token = signConsentToken(binding);
    expect(verifyConsentToken(token, { ...binding, userId: 'attacker' })).toBe(false);
  });

  it('rejects tampering with client_id, redirect_uri or PKCE challenge', () => {
    const token = signConsentToken(binding);
    expect(verifyConsentToken(token, { ...binding, clientId: 'gpc_other' })).toBe(false);
    expect(verifyConsentToken(token, { ...binding, redirectUri: 'https://evil.test/cb' })).toBe(false);
    expect(verifyConsentToken(token, { ...binding, codeChallenge: 'tampered' })).toBe(false);
  });

  it('rejects malformed tokens', () => {
    expect(verifyConsentToken('', binding)).toBe(false);
    expect(verifyConsentToken('garbage', binding)).toBe(false);
    expect(verifyConsentToken('999.notbase64', binding)).toBe(false);
  });

  it('rejects an expired token', () => {
    // Forge a token with an already-past expiry but a correctly-shaped sig:
    // signing fresh then editing the exp invalidates the HMAC, so this also
    // proves the exp is covered by the signature.
    const token = signConsentToken(binding);
    const sig = token.slice(token.indexOf('.') + 1);
    const expired = `${Date.now() - 1000}.${sig}`;
    expect(verifyConsentToken(expired, binding)).toBe(false);
  });
});

describe('verifyPkceS256', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

  it('accepts the matching S256 challenge', () => {
    expect(verifyPkceS256(verifier, s256(verifier))).toBe(true);
  });

  it('rejects a wrong verifier', () => {
    expect(verifyPkceS256('not-the-verifier', s256(verifier))).toBe(false);
  });

  it('rejects empty inputs', () => {
    expect(verifyPkceS256('', s256(verifier))).toBe(false);
    expect(verifyPkceS256(verifier, '')).toBe(false);
  });
});
