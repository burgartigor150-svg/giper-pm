/**
 * Fuzzy title matching for pairing a Kaiten card with its Bitrix-mirrored twin
 * (the same task is often re-created in both systems with no shared id). Pure +
 * deterministic so it's fully unit-testable offline.
 */

/** Strip a leading task-key / number / bracket-tag prefix that one side adds. */
const PREFIX_RE = /^\s*(?:\[[^\]]*\]\s*|#\d+\s*|[A-Za-zА-Яа-я]{1,8}[-_]\d+[:.)\s]+|\d+[.)]\s+)/;

/** Normalize a title for comparison: drop a leading key/tag, lowercase, strip
 * punctuation, collapse whitespace, fold ё→е. */
export function normalizeTitle(title: string): string {
  let s = (title ?? '').trim();
  // strip up to two leading prefixes (e.g. "[BUG] PROJ-12: ...")
  for (let i = 0; i < 2; i++) {
    const next = s.replace(PREFIX_RE, '');
    if (next === s) break;
    s = next;
  }
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(norm: string): Set<string> {
  return new Set(norm.split(' ').filter((t) => t.length >= 2));
}

/** Token-set Dice coefficient over two pre-normalized titles. */
function dice(aNorm: string, aTokens: Set<string>, bNorm: string, bTokens: Set<string>): number {
  if (!aNorm || !bNorm) return 0;
  if (aNorm === bNorm) return 1;
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let inter = 0;
  for (const t of aTokens) if (bTokens.has(t)) inter++;
  return (2 * inter) / (aTokens.size + bTokens.size);
}

/**
 * Similarity in [0,1] between two raw titles — token-set Dice coefficient over
 * normalized words, so word order and minor edits don't matter. Identical
 * normalized titles → 1; no shared words → 0.
 */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  return dice(na, tokens(na), nb, tokens(nb));
}

/** Auto-link when we're confident; suggest (for manual review) in between. */
export const AUTO_LINK_THRESHOLD = 0.9;
export const SUGGEST_THRESHOLD = 0.55;

export type MatchConfidence = 'auto' | 'suggest' | 'none';
export function classifyMatch(score: number): MatchConfidence {
  if (score >= AUTO_LINK_THRESHOLD) return 'auto';
  if (score >= SUGGEST_THRESHOLD) return 'suggest';
  return 'none';
}

/**
 * Pick the best candidate (by similarity) for a Kaiten title among Bitrix tasks.
 * Returns null if nothing clears the suggest threshold.
 */
export function bestMatch(
  kaitenTitle: string,
  candidates: { id: string; title: string }[],
): { id: string; title: string; score: number; confidence: MatchConfidence } | null {
  const na = normalizeTitle(kaitenTitle);
  const ta = tokens(na);
  let best: { id: string; title: string; score: number } | null = null;
  for (const c of candidates) {
    const nb = normalizeTitle(c.title);
    const score = dice(na, ta, nb, tokens(nb));
    if (!best || score > best.score) best = { id: c.id, title: c.title, score };
  }
  if (!best) return null;
  const confidence = classifyMatch(best.score);
  return confidence === 'none' ? null : { ...best, confidence };
}

/** A candidate with its title pre-normalized, so a batch of cards can be matched
 *  without re-normalizing the same candidate titles O(n) times. */
export type PreparedCandidate = { id: string; norm: string; tokens: Set<string> };

export function prepareCandidates(candidates: { id: string; title: string }[]): PreparedCandidate[] {
  return candidates.map((c) => {
    const norm = normalizeTitle(c.title);
    return { id: c.id, norm, tokens: tokens(norm) };
  });
}

/** Like bestMatch, but against pre-normalized candidates (see prepareCandidates). */
export function bestMatchPrepared(
  kaitenTitle: string,
  prepared: PreparedCandidate[],
): { id: string; score: number; confidence: MatchConfidence } | null {
  const na = normalizeTitle(kaitenTitle);
  const ta = tokens(na);
  let best: { id: string; score: number } | null = null;
  for (const c of prepared) {
    const score = dice(na, ta, c.norm, c.tokens);
    if (!best || score > best.score) best = { id: c.id, score };
  }
  if (!best) return null;
  const confidence = classifyMatch(best.score);
  return confidence === 'none' ? null : { ...best, confidence };
}
