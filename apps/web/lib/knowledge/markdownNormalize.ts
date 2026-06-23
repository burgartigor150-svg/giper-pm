/**
 * Normalize markdown produced by the WYSIWYG editor before it's saved:
 *  1. un-escape any `[[table:ID]]` embed token the serializer backslash-escaped;
 *  2. drop stray `:::` closers (container depth < 0) so pathological/pasted
 *     nested input can't leak unbalanced markers that the non-nesting read
 *     renderer would otherwise show as literal text.
 * Pure + dependency-free so it's shared by the editor and unit tests.
 */
export function normalizeKbMarkdown(md: string): string {
  const unescaped = md.replace(/\\\[\\\[table:([A-Za-z0-9_-]+)\\\]\\\]/g, '[[table:$1]]');
  let depth = 0;
  const out: string[] = [];
  for (const line of unescaped.split('\n')) {
    const t = line.trim();
    if (/^:::\S/.test(t)) {
      depth += 1; // opener (:::info, :::details Заголовок, …)
      out.push(line);
    } else if (t === ':::') {
      if (depth > 0) {
        depth -= 1; // matched closer
        out.push(line);
      }
      // else: stray closer at depth 0 → drop it
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}
