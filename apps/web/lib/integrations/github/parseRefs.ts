/**
 * Parse `KEY-N` task references out of a free-text string. Used on
 * commit messages, PR titles, PR bodies, and branch names.
 *
 * KEY = 2..5 uppercase letters/digits (matches our project key shape
 * `[A-Z][A-Z0-9]{1,4}`); we also accept lowercase and uppercase the
 * KEY at the boundary to forgive typos like `ksria-42`.
 *
 * Returns deduped, uppercase-normalised refs.
 */
export type TaskRef = { projectKey: string; number: number };

const RE = /\b([A-Za-z][A-Za-z0-9]{1,4})-(\d{1,6})\b/g;

export function parseTaskRefs(text: string): TaskRef[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: TaskRef[] = [];
  let m: RegExpExecArray | null;
  while ((m = RE.exec(text)) !== null) {
    const key = m[1]!.toUpperCase();
    const num = Number(m[2]!);
    if (!Number.isFinite(num) || num < 1) continue;
    const id = `${key}-${num}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ projectKey: key, number: num });
  }
  return out;
}
