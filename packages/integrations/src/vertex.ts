/**
 * Google Vertex AI client (Gemini family). Authenticates via a service
 * account JSON pointed at by GOOGLE_APPLICATION_CREDENTIALS — same
 * pattern the host's other services use, no per-process API keys.
 *
 * Required env (host /opt/giper-pm/.env):
 *   GOOGLE_APPLICATION_CREDENTIALS  /secrets/gcp-sa.json
 *   GOOGLE_CLOUD_PROJECT            gen-lang-client-...
 *   GOOGLE_CLOUD_LOCATION           us-central1
 *
 * The service account file must be mounted into the container at the
 * same path (see docker-compose.prod.yml `volumes` for transcribe-worker
 * and web).
 */

import { VertexAI, type GenerativeModel, type GenerationConfig, type Schema } from '@google-cloud/vertexai';

let _client: VertexAI | null = null;
function client(): VertexAI {
  if (_client) return _client;
  const project = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  const location = process.env.GOOGLE_CLOUD_LOCATION?.trim() || 'us-central1';
  if (!project) throw new Error('GOOGLE_CLOUD_PROJECT is not set');
  _client = new VertexAI({ project, location });
  return _client;
}

const _modelCache = new Map<string, GenerativeModel>();
function model(name: string): GenerativeModel {
  const cached = _modelCache.get(name);
  if (cached) return cached;
  const m = client().getGenerativeModel({
    model: name,
    safetySettings: [],
  });
  _modelCache.set(name, m);
  return m;
}

/**
 * True if Vertex AI is configured AND likely usable. Call sites use
 * this to decide whether to hit Gemini or fall back to Ollama.
 */
export function isVertexEnabled(): boolean {
  return Boolean(
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() &&
      process.env.GOOGLE_CLOUD_PROJECT?.trim(),
  );
}

export async function vertexChat(opts: {
  model?: string;
  system: string;
  user: string;
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<string> {
  const m = model(opts.model || process.env.VERTEX_CHAT_MODEL?.trim() || 'gemini-2.5-flash');
  const generationConfig: GenerationConfig = {
    temperature: opts.temperature ?? 0.3,
    maxOutputTokens: opts.maxOutputTokens ?? 8192,
  };
  const res = await m.generateContent({
    systemInstruction: { role: 'system', parts: [{ text: opts.system }] },
    contents: [{ role: 'user', parts: [{ text: opts.user }] }],
    generationConfig,
  });
  const text = res.response?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text || '')
    .join('')
    .trim();
  return text || '';
}

/**
 * Same as vertexChat but constrains output to a JSON schema. Returns
 * the parsed object (or null if parsing fails, never throws on bad
 * JSON — caller decides what to do).
 */
export async function vertexJson<T = unknown>(opts: {
  model?: string;
  system: string;
  user: string;
  schema: Schema;
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<T | null> {
  const m = model(opts.model || process.env.VERTEX_JSON_MODEL?.trim() || 'gemini-2.5-flash');
  const generationConfig: GenerationConfig = {
    temperature: opts.temperature ?? 0.2,
    maxOutputTokens: opts.maxOutputTokens ?? 8192,
    responseMimeType: 'application/json',
    responseSchema: opts.schema,
  };
  const res = await m.generateContent({
    systemInstruction: { role: 'system', parts: [{ text: opts.system }] },
    contents: [{ role: 'user', parts: [{ text: opts.user }] }],
    generationConfig,
  });
  const text = res.response?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text || '')
    .join('')
    .trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    // Sometimes Gemini wraps JSON in markdown despite responseMimeType.
    const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      // eslint-disable-next-line no-console
      console.warn('[vertex] vertexJson: model returned non-JSON', text.slice(0, 300));
      return null;
    }
  }
}
