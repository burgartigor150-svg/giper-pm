/**
 * Parse a repository URL into { repo, baseUrl } for a given forge.
 *
 * Accepts https and SSH (`git@host:group/repo.git`) forms. `repo` is the
 * path without leading slash or trailing `.git`. `baseUrl` is the forge origin
 * for self-hosted instances (GitLab CE/EE, GitHub Enterprise); null for the
 * public hosts (github.com / gitlab.com) so the API client uses defaults.
 */
export type ParsedRepo = { repo: string; baseUrl: string | null };

const PUBLIC_HOSTS: Record<string, string> = {
  github: 'github.com',
  gitlab: 'gitlab.com',
};

export function parseRepoUrl(provider: string, raw: string): ParsedRepo | null {
  const input = (raw ?? '').trim();
  if (!input) return null;

  let host = '';
  let scheme = 'https';
  let path = '';

  const ssh = input.match(/^git@([^:]+):(.+)$/);
  if (ssh) {
    host = ssh[1]!;
    path = ssh[2]!;
  } else {
    let u: URL;
    try {
      u = new URL(input.includes('://') ? input : `https://${input}`);
    } catch {
      return null;
    }
    host = u.host;
    scheme = u.protocol.replace(':', '') || 'https';
    path = u.pathname;
  }

  const repo = path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  if (!repo || !repo.includes('/')) return null;

  const publicHost = PUBLIC_HOSTS[provider];
  const baseUrl =
    publicHost && host.toLowerCase() === publicHost ? null : `${scheme}://${host}`;

  return { repo, baseUrl };
}
