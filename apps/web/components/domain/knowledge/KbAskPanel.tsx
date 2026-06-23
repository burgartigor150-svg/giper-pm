'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { FileText, Sparkles } from 'lucide-react';
import { askKnowledgeAction } from '@/actions/knowledgeAi';
import { renderMarkdown } from '@/lib/knowledge/renderMarkdown';

type Source = { id: string; title: string };

/**
 * Ask-the-KB panel (TEAMLY AI). Sends a question to the LLM grounded in the
 * user's viewable published articles; shows the answer + cited sources.
 */
export function KbAskPanel() {
  const [pending, startTransition] = useTransition();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState<string | null>(null);

  function ask() {
    const q = question.trim();
    if (q.length < 3) return;
    setError(null);
    setAnswer(null);
    setSources([]);
    startTransition(async () => {
      const res = await askKnowledgeAction(q);
      if (res.ok) {
        setAnswer(res.answer || 'Пустой ответ.');
        setSources(res.sources);
      } else {
        setError(res.error.message);
      }
    });
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Sparkles className="h-6 w-6 text-violet-500" /> Спросить базу знаний
        </h1>
        <p className="text-sm text-muted-foreground">
          ИИ отвечает на основе статей, к которым у вас есть доступ, и ссылается на источники.
        </p>
      </header>

      <div className="flex flex-col gap-2">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask();
          }}
          placeholder="Например: как оформить отпуск? где регламент по релизам?"
          rows={3}
          className="w-full resize-y rounded-lg border border-neutral-300 p-3 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={ask}
            disabled={pending || question.trim().length < 3}
            className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" /> {pending ? 'Думаю…' : 'Спросить'}
          </button>
          <span className="text-xs text-muted-foreground">⌘/Ctrl + Enter</span>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {error}
        </div>
      ) : null}

      {answer !== null ? (
        <div className="flex flex-col gap-3">
          <article className="max-w-none break-words rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
            {renderMarkdown(answer)}
          </article>
          {sources.length > 0 ? (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Источники</p>
              <ul className="flex flex-col gap-1">
                {sources.map((s) => (
                  <li key={s.id}>
                    <Link href={`/knowledge/${s.id}`} className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline dark:text-blue-400">
                      <FileText className="h-3.5 w-3.5" /> {s.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
