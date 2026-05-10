/**
 * Two LLM passes through Qwen 14B (Ollama) over a freshly-transcribed
 * meeting:
 *
 *   1. summary — concise Russian rundown: decisions, action items
 *      with owners + dates, open questions.
 *   2. tasks — re-uses `proposeTasks` from @giper/integrations (same
 *      flow as TG-harvest), feeding each transcript segment as a
 *      "message" with author = speaker label.
 *
 * Both calls use the same OLLAMA_BASE_URL and LLM_MODEL env vars as
 * the existing aiHarvest path.
 */

import {
  proposeTasks,
  type ChatMessageInput,
  type ProjectContext,
  type TaskProposal,
  type TranscriptSegment,
} from '@giper/integrations';

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1';
const DEFAULT_MODEL = 'qwen2.5:14b';
const REQUEST_TIMEOUT_MS = Number(process.env.LLM_REQUEST_TIMEOUT_MS) > 0 ? Number(process.env.LLM_REQUEST_TIMEOUT_MS) : 600_000;

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

function formatTranscriptForPrompt(segments: TranscriptSegment[]): string {
  if (!segments.length) return '(транскрипт пуст)';
  // Cap at ~30k chars to fit context — Qwen 14B is 128k but Ollama
  // default num_ctx is much smaller; trim to be safe.
  let bytes = 0;
  const out: string[] = [];
  for (const s of segments) {
    const speaker = s.speaker || 'SPEAKER';
    const t = `[${formatTime(s.start)}] ${speaker}: ${s.text}`;
    bytes += t.length;
    if (bytes > 30_000) {
      out.push('… (транскрипт обрезан)');
      break;
    }
    out.push(t);
  }
  return out.join('\n');
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export async function summarizeMeeting(segments: TranscriptSegment[]): Promise<string> {
  const { baseUrl, model } = llmConfig();
  const transcript = formatTranscriptForPrompt(segments);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: SUMMARY_SYSTEM },
          { role: 'user', content: `Транскрипт встречи:\n\n${transcript}` },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`LLM summary HTTP ${res.status}`);
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return (json.choices?.[0]?.message?.content || '').trim();
  } finally {
    clearTimeout(t);
  }
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
  const messages: ChatMessageInput[] = segments.map((s, i) => ({
    id: `seg_${i}`,
    author: s.speaker || 'SPEAKER',
    timestamp: new Date(meetingStartedAt.getTime() + s.start * 1000).toISOString(),
    text: s.text,
    hasAttachment: false,
  }));
  const r = await proposeTasks(messages, project);
  if (!r.ok) return [];
  // Re-anchor sourceMessageIds: proposeTasks works with our synthetic
  // ids (`seg_<n>`); UI doesn't render these so leaving them as-is is
  // fine. We just clean up the array length.
  return r.proposals;
}
