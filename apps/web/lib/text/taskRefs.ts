/**
 * Detect task references inside arbitrary text (chat messages,
 * comments, etc.) so we can show a rich preview card.
 *
 * Supported shapes:
 *
 *   1. Short form:     GPM-142            (PROJECT_KEY-NUMBER, all-caps)
 *   2. URL path:       /projects/GPM/tasks/142
 *   3. Absolute URL:   https://pm.since-b24-ru.ru/projects/GPM/tasks/142
 *                      http://localhost:3000/projects/GPM/tasks/142
 *
 * Keys are 2–5 uppercase A–Z chars (per `generateProjectKey`).
 * Numbers are positive integers up to 6 digits — there is no
 * project in this org with >999_999 tasks, and capping protects
 * against quadratic regex backtracks on pathological input.
 *
 * The returned set is DEDUPED by (key, number) so the renderer
 * never shows the same task twice if the user pasted the link
 * and the short key on the same line.
 */

export type TaskRef = {
  key: string; // "GPM"
  number: number; // 142
};

// Negative lookbehind: key prefix must start at the beginning of the
// string OR right after whitespace/punctuation — not in the middle of
// a word like "MFOO-1". Negative lookahead on the trailing digit
// rejects things like "GPM-12a" or "GPM-1234567" (>6 digits).
const SHORT_RE = /(?<![A-Z0-9])([A-Z]{2,5})-(\d{1,6})(?!\d)/g;
const PATH_RE = /\/projects\/([A-Z]{2,5})\/tasks\/(\d{1,6})(?!\d)/gi;

/**
 * Cheap synchronous parse. Doesn't hit the DB — just extracts what
 * the regex sees. Pair with `loadTaskPreviewsForRefs` to fetch the
 * actual task rows, then with visibility filtering before rendering.
 */
export function extractTaskRefs(input: string | null | undefined): TaskRef[] {
  if (!input) return [];
  const seen = new Set<string>();
  const refs: TaskRef[] = [];

  // Two passes against the same input. Important: each regex needs
  // its own lastIndex reset because the `g` flag is stateful.
  SHORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SHORT_RE.exec(input)) !== null) {
    const key = m[1]!;
    const num = Number(m[2]);
    if (!Number.isInteger(num) || num <= 0) continue;
    const k = `${key}-${num}`;
    if (seen.has(k)) continue;
    seen.add(k);
    refs.push({ key, number: num });
  }

  PATH_RE.lastIndex = 0;
  while ((m = PATH_RE.exec(input)) !== null) {
    const key = m[1]!.toUpperCase();
    const num = Number(m[2]);
    if (!Number.isInteger(num) || num <= 0) continue;
    const k = `${key}-${num}`;
    if (seen.has(k)) continue;
    seen.add(k);
    refs.push({ key, number: num });
  }

  return refs;
}
