'use server';

import { askKnowledgeBase } from '@giper/integrations';
import { requireAuth } from '@/lib/auth';
import { retrieveForAi } from '@/lib/knowledge/getKnowledge';

type AskResult =
  | { ok: true; answer: string; sources: { id: string; title: string }[] }
  | { ok: false; error: { code: string; message: string } };

/**
 * Answer a question over the Knowledge Base (TEAMLY AI). Retrieves published
 * articles the user may view, grounds the LLM answer in them, and returns the
 * answer plus the cited sources. The retrieval respects per-space access, so no
 * private content leaks to non-members.
 */
export async function askKnowledgeAction(question: string): Promise<AskResult> {
  const me = await requireAuth();
  const q = question.trim();
  if (q.length < 3) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Слишком короткий вопрос' } };
  }
  if (q.length > 1000) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Слишком длинный вопрос' } };
  }

  const articles = await retrieveForAi(me, q, 6);
  const res = await askKnowledgeBase(
    q,
    articles.map((a) => ({ id: a.id, title: a.title, content: a.content, spaceName: a.space.name })),
  );
  if (!res.ok) {
    return { ok: false, error: { code: 'AI_UNAVAILABLE', message: res.message ?? 'ИИ недоступен' } };
  }
  return {
    ok: true,
    answer: res.answer,
    sources: articles.map((a) => ({ id: a.id, title: a.title })),
  };
}
