/**
 * Two LLM passes through Qwen 14B (Ollama) over a freshly-transcribed
 * meeting:
 *
 *   1. summary — concise Russian rundown: decisions, action items
 *      with owners + dates, open questions. For long meetings (2h+
 *      with 20+ participants) we do MAP-REDUCE: split transcript into
 *      ~25k-char chunks, summarize each, then meta-summarize the
 *      partials. This keeps each LLM call within Qwen's effective
 *      context window even with `num_ctx=32768`.
 *   2. tasks — re-uses `proposeTasks` from @giper/integrations (same
 *      flow as TG-harvest), feeding each transcript segment as a
 *      "message" with author = speaker label.
 *
 * Both calls use the same OLLAMA_BASE_URL and LLM_MODEL env vars as
 * the existing aiHarvest path.
 */

import {
  isVertexEnabled,
  proposeTasksFromMeeting,
  vertexChat,
  type ChatMessageInput,
  type ProjectContext,
  type TaskProposal,
  type TranscriptSegment,
} from '@giper/integrations';

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1';
const DEFAULT_MODEL = 'qwen2.5:14b';
const REQUEST_TIMEOUT_MS = Number(process.env.LLM_REQUEST_TIMEOUT_MS) > 0 ? Number(process.env.LLM_REQUEST_TIMEOUT_MS) : 600_000;

// Effective ctx for Qwen 14B on Ollama: we explicitly request 32768
// tokens. With ~3.5 chars per token (ru) that's ~110k chars, so we
// chunk transcripts at 25k chars to leave room for system prompt +
// instructions + response.
const NUM_CTX = Number(process.env.LLM_NUM_CTX) > 0 ? Number(process.env.LLM_NUM_CTX) : 32_768;
const CHUNK_CHARS = 25_000;
const HARD_TRANSCRIPT_CAP = 250_000; // safety: ~5h of speech
const PARTIAL_SUMMARY_TARGET_CHARS = 1_500;

function llmConfig() {
  return {
    baseUrl: (process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, ''),
    model: process.env.LLM_MODEL?.trim() || DEFAULT_MODEL,
  };
}

const SUMMARY_SYSTEM = `Ты — ассистент проектного менеджера. Тебе дан транскрипт рабочей встречи (русский). Сделай краткое саммари (ru, 800–1500 символов) в трёх частях:

1) Решения — что было решено и кем (если можно).
2) Action items — конкретные задачи с владельцами и сроками (или "срок не упомянут").
3) Открытые вопросы — что не решили, что требует следующей встречи.

Если транскрипт совсем короткий или пустой — пиши «Записано слишком мало содержательного», без выдумок. Не используй markdown — обычный текст с заголовками "Решения:", "Action items:", "Открытые вопросы:".`;

const PARTIAL_SUMMARY_SYSTEM = `Ты — ассистент проектного менеджера. Тебе дан ФРАГМЕНТ транскрипта длинной рабочей встречи (русский). Сделай ОЧЕНЬ КРАТКОЕ саммари этого фрагмента (ru, до ${PARTIAL_SUMMARY_TARGET_CHARS} символов): что обсуждалось, какие решения, какие задачи, какие вопросы остались. Не выдумывай. Чистый текст без markdown.`;

const META_SUMMARY_SYSTEM = `Ты — ассистент проектного менеджера. Тебе дано НЕСКОЛЬКО последовательных кратких саммари фрагментов одной длинной рабочей встречи. Сложи их в единое финальное саммари (ru, 1000–2000 символов) в трёх частях:

1) Решения — что было решено и кем (если можно).
2) Action items — конкретные задачи с владельцами и сроками (или "срок не упомянут").
3) Открытые вопросы — что не решили, что требует следующей встречи.

Удаляй дубликаты, объединяй связанные пункты. Чистый текст без markdown с заголовками "Решения:", "Action items:", "Открытые вопросы:".`;

/**
 * Format a slice of segments into a single prompt string. If `cap` is
 * exceeded we cut and append a notice. Used both for short (<25k)
 * one-shot summaries and for individual chunks in map-reduce.
 */
function formatTranscript(segments: TranscriptSegment[], cap = CHUNK_CHARS): string {
  if (!segments.length) return '(транскрипт пуст)';
  let bytes = 0;
  const out: string[] = [];
  for (const s of segments) {
    const speaker = s.speaker || 'SPEAKER';
    const t = `[${formatTime(s.start)}] ${speaker}: ${s.text}`;
    if (bytes + t.length > cap) {
      out.push('… (фрагмент обрезан)');
      break;
    }
    out.push(t);
    bytes += t.length;
  }
  return out.join('\n');
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Split segments into roughly-equal chunks no larger than CHUNK_CHARS
 * each. Tries to break at segment boundaries to preserve speaker
 * attribution. Caps total at HARD_TRANSCRIPT_CAP (drops tail).
 */
function chunkSegments(segments: TranscriptSegment[]): TranscriptSegment[][] {
  const chunks: TranscriptSegment[][] = [];
  let current: TranscriptSegment[] = [];
  let bytes = 0;
  let total = 0;
  for (const s of segments) {
    const line = `[${formatTime(s.start)}] ${s.speaker || 'SPEAKER'}: ${s.text}`;
    const len = line.length + 1;
    if (total + len > HARD_TRANSCRIPT_CAP) break;
    if (bytes + len > CHUNK_CHARS && current.length) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(s);
    bytes += len;
    total += len;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/**
 * Low-level chat completion. Routes to Google Vertex AI (Gemini) when
 * `GOOGLE_APPLICATION_CREDENTIALS` + `GOOGLE_CLOUD_PROJECT` are set
 * (preferred — no GPU contention with WhisperX, runs in Google Cloud);
 * otherwise falls back to local Ollama. Same prompt + temperature for
 * both — we don't try to match output formats exactly because the
 * caller post-processes anyway.
 */
async function chatCompletion({
  system,
  user,
  temperature = 0.3,
}: {
  system: string;
  user: string;
  temperature?: number;
}): Promise<string> {
  if (isVertexEnabled()) {
    return vertexChat({ system, user, temperature });
  }
  const { baseUrl, model } = llmConfig();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        // Ollama-specific: extends context to 32k tokens for this call.
        // Other OpenAI-compatible servers ignore this field.
        options: { num_ctx: NUM_CTX },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return (json.choices?.[0]?.message?.content || '').trim();
  } finally {
    clearTimeout(t);
  }
}

/**
 * Top-level: summarize a transcript of any length.
 *
 *   - short (<= CHUNK_CHARS):   1 LLM call, direct.
 *   - long  (> CHUNK_CHARS):    map-reduce: N partial summaries +
 *                               1 meta-summary.
 */
export async function summarizeMeeting(segments: TranscriptSegment[]): Promise<string> {
  if (!segments.length) return 'Записано слишком мало содержательного';

  const totalChars = segments.reduce((acc, s) => acc + (s.text?.length || 0) + 20, 0);
  if (totalChars <= CHUNK_CHARS) {
    return chatCompletion({
      system: SUMMARY_SYSTEM,
      user: `Транскрипт встречи:\n\n${formatTranscript(segments, CHUNK_CHARS)}`,
    });
  }

  const chunks = chunkSegments(segments);
  // eslint-disable-next-line no-console
  console.log(`[summary] map-reduce over ${chunks.length} chunks (~${Math.round(totalChars / 1000)}k chars total)`);
  const partials: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk || !chunk.length) continue;
    const text = formatTranscript(chunk, CHUNK_CHARS);
    const partial = await chatCompletion({
      system: PARTIAL_SUMMARY_SYSTEM,
      user: `Фрагмент ${i + 1} из ${chunks.length}:\n\n${text}`,
      temperature: 0.2,
    });
    if (partial) partials.push(`Фрагмент ${i + 1}:\n${partial}`);
  }
  if (!partials.length) return 'Записано слишком мало содержательного';
  if (partials.length === 1) return (partials[0] || '').replace(/^Фрагмент 1:\n/, '');

  return chatCompletion({
    system: META_SUMMARY_SYSTEM,
    user: `Краткие саммари последовательных фрагментов одной встречи:\n\n${partials.join('\n\n')}`,
    temperature: 0.3,
  });
}

/**
 * Convert WhisperX segments into the same `ChatMessageInput[]` shape
 * that `proposeTasks` expects — "messages" become per-segment lines
 * with `author = speaker label`. The function returns the proposed
 * tasks (or an empty array if the LLM gave up).
 */
export async function proposeMeetingTasks(
  segments: TranscriptSegment[],
  project: ProjectContext,
  meetingStartedAt: Date,
): Promise<TaskProposal[]> {
  if (!segments.length) return [];
  // For very long meetings we keep the most recent ~3500 segments —
  // proposeTasks already chunks internally but the LLM-side call has
  // a hard 32k context, so we trim conservatively here too.
  const trimmed = segments.length > 4000 ? segments.slice(-4000) : segments;
  const messages: ChatMessageInput[] = trimmed.map((s, i) => ({
    id: `seg_${i}`,
    author: s.speaker || 'SPEAKER',
    timestamp: new Date(meetingStartedAt.getTime() + s.start * 1000).toISOString(),
    text: s.text,
    hasAttachment: false,
  }));
  const r = await proposeTasksFromMeeting(messages, project);
  if (!r.ok) return [];
  return r.proposals;
}
