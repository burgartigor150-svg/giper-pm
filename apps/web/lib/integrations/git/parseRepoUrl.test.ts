import { describe, it, expect } from 'vitest';
import { parseRepoUrl } from './parseRepoUrl';

describe('parseRepoUrl', () => {
  it('parses public github https (baseUrl null)', () => {
    expect(parseRepoUrl('github', 'https://github.com/owner/repo')).toEqual({
      repo: 'owner/repo',
      baseUrl: null,
    });
  });

  it('strips .git and trailing slash', () => {
    expect(parseRepoUrl('github', 'https://github.com/owner/repo.git/')).toEqual({
      repo: 'owner/repo',
      baseUrl: null,
    });
  });

  it('parses github ssh form', () => {
    expect(parseRepoUrl('github', 'git@github.com:owner/repo.git')).toEqual({
      repo: 'owner/repo',
      baseUrl: null,
    });
  });

  it('parses public gitlab with nested group', () => {
    expect(parseRepoUrl('gitlab', 'https://gitlab.com/group/sub/repo')).toEqual({
      repo: 'group/sub/repo',
      baseUrl: null,
    });
  });

  it('keeps baseUrl for self-hosted gitlab', () => {
    expect(parseRepoUrl('gitlab', 'https://git.acme.ru/team/app')).toEqual({
      repo: 'team/app',
      baseUrl: 'https://git.acme.ru',
    });
  });

  it('keeps baseUrl for github enterprise', () => {
    expect(parseRepoUrl('github', 'https://ghe.acme.com/team/app')).toEqual({
      repo: 'team/app',
      baseUrl: 'https://ghe.acme.com',
    });
  });

  it('accepts bare host/path without scheme', () => {
    expect(parseRepoUrl('gitlab', 'gitlab.com/group/repo')).toEqual({
      repo: 'group/repo',
      baseUrl: null,
    });
  });

  it('rejects junk / paths without a group', () => {
    expect(parseRepoUrl('github', '')).toBeNull();
    expect(parseRepoUrl('github', 'https://github.com/onlyowner')).toBeNull();
    expect(parseRepoUrl('github', 'not a url at all')).toBeNull();
  });
});
