import { prisma } from '@giper/db';

/**
 * Parse @-mentions out of a comment body. The convention we use is
 * `@<userId>` in the stored text — the client autocompletes the human
 * name → userId at typing time, so the server doesn't have to do
 * fuzzy-match resolution and we never accidentally ping a wrong Igor.
 *
 * Cuids look like `cmoc7m9b9000abcd...`. We accept anything that's
 * 24+ chars of [a-z0-9] right after `@`.
 *
 * Returns the userIds that actually exist and are active. Unknown ids
 * are silently dropped so a stale or hand-typed mention doesn't error
 * the comment submission.
 */
export async function extractValidMentions(body: string): Promise<string[]> {
  const ids = new Set<string>();
  const re = /@([a-z0-9]{24,})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[1]) ids.add(m[1]);
  }
  if (ids.size === 0) return [];
  const found = await prisma.user.findMany({
    where: { id: { in: [...ids] }, isActive: true },
    select: { id: true },
  });
  return found.map((u) => u.id);
}
