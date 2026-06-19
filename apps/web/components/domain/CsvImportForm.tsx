'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@giper/ui/components/Button';
import { importTasksFromCsvAction, type ImportResult } from '@/actions/importTasks';

const SAMPLE = `title,description,type,priority,assignee,due,estimate,tags
Сверстать лендинг,Главная страница,FEATURE,HIGH,user@example.com,2026-07-01,8,frontend;дизайн
Починить баг логина,,BUG,URGENT,,,2,backend`;

export function CsvImportForm({ projectKey }: { projectKey: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  function run() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const res = await importTasksFromCsvAction(projectKey, text);
      if (res.ok) {
        setResult(res.data);
        if (res.data.created > 0) router.refresh();
      } else {
        setError(res.error.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Вставьте CSV. Первая строка — заголовки колонок (RU или EN):{' '}
        <code>title</code> (обязательно), <code>description</code>, <code>type</code>,{' '}
        <code>priority</code>, <code>assignee</code> (e-mail), <code>due</code> (ГГГГ-ММ-ДД),{' '}
        <code>estimate</code> (часы), <code>tags</code> (через <code>;</code>).
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={pending}
        rows={12}
        placeholder={SAMPLE}
        className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
      />
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" onClick={run} disabled={pending || text.trim() === ''}>
          {pending ? 'Импортирую…' : 'Импортировать'}
        </Button>
        <button
          type="button"
          onClick={() => setText(SAMPLE)}
          disabled={pending}
          className="text-xs text-muted-foreground underline disabled:opacity-50"
        >
          Вставить пример
        </button>
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </div>

      {result ? (
        <div className="rounded-md border p-3 text-sm">
          <p className="font-medium text-emerald-600">Создано: {result.created}</p>
          {result.failed > 0 ? (
            <>
              <p className="mt-1 text-destructive">Ошибок: {result.failed}</p>
              <ul className="mt-1 max-h-40 overflow-auto text-xs text-muted-foreground">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    Строка {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
