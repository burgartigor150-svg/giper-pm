import { isVertexEnabled, vertexChat } from './vertex';

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1';
const DEFAULT_MODEL = 'qwen2.5:14b';
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_SOURCE_CHARS = 4_000;

export type KbSource = { id: string; title: string; content: string; spaceName?: string };
export type AskKbResult = { ok: boolean; answer: string; message?: string };

const SYSTEM_PROMPT = `Ты — ассистент корпоративной базы знаний.
Отвечай на вопрос пользователя ТОЛЬКО на основе предоставленных фрагментов статей.
Если ответа во фрагментах нет — честно скажи, что не нашёл информации в базе знаний, и не выдумывай.
Пиши кратко, по делу, на русском. Где уместно — ссылайся на названия статей.`;

function buildUserPrompt(question: string, sources: KbSource[]): string {
  const context =
    sources
      .map(
        (s, i) =>
          `[Статья ${i + 1}: ${s.title}${s.spaceName ? ` · ${s.spaceName}` : ''}]\n${s.content.slice(0, MAX_SOURCE_CHARS)}`,
      )
      .join('\n\n---\n\n') || '(подходящих статей не найдено)';
  return `Вопрос: ${question}\n\nФрагменты базы знаний:\n${context}`;
}

/**
 * Answer a question grounded in the supplied KB article fragments (TEAMLY AI).
 * Prefers Vertex/Gemini when configured, else an Ollama / OpenAI-compatible
 * endpoint. Never throws — returns { ok:false, message } on failure so the
 * caller can show a graceful error.
 */
export async function askKnowledgeBase(question: string, sources: KbSource[]): Promise<AskKbResult> {
  const user = buildUserPrompt(question, sources);
  try {
    if (isVertexEnabled()) {
      const text = await vertexChat({ system: SYSTEM_PROMPT, user, temperature: 0.2 });
      return { ok: true, answer: text };
    }
    const baseUrl = (process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, '');
    const model = process.env.LLM_MODEL?.trim() || DEFAULT_MODEL;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: user },
          ],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { ok: false, answer: '', message: `LLM HTTP ${res.status}: ${body.slice(0, 200)}` };
      }
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = json.choices?.[0]?.message?.content ?? '';
      return { ok: true, answer: content };
    } finally {
      clearTimeout(t);
    }
  } catch (e) {
    return { ok: false, answer: '', message: e instanceof Error ? e.message : 'LLM error' };
  }
}
