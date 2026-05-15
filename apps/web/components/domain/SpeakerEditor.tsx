'use client';

import { useState, useTransition } from 'react';
import { Button } from '@giper/ui/components/Button';
import { Input } from '@giper/ui/components/Input';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { setMeetingSpeakerMapAction } from '@/actions/meetings';

type SavedEntry = { userId?: string | null; name: string };

/**
 * Speaker re-attribution UI. WhisperX gives us anonymous SPEAKER_00,
 * SPEAKER_01, … labels — stable within one transcript but meaningless
 * to a human. The page shows "Спикер 1/2/…" as a default; this editor
 * lets the meeting creator (or ADMIN / project PM) pin each label to
 * a real participant or a free-form name.
 *
 * Submit is "save everything you see at once". The action overwrites
 * the whole speakerMap, so partial updates are non-destructive —
 * the editor's local state is the source of truth for the next save.
 */
export function SpeakerEditor({
  meetingId,
  labels,
  saved,
  participants,
}: {
  meetingId: string;
  labels: string[];
  saved: Record<string, SavedEntry>;
  participants: { key: string; userId: string | null; label: string }[];
}) {
  // Local editable state — start from saved values + a "Спикер N+1"
  // placeholder for any label that isn't pinned yet.
  type Row = { userId: string | null; name: string };
  const initial: Record<string, Row> = {};
  labels.forEach((lbl, i) => {
    const s = saved[lbl];
    initial[lbl] = {
      userId: s?.userId ?? null,
      name: s?.name?.trim() || `Спикер ${i + 1}`,
    };
  });
  const [rows, setRows] = useState<Record<string, Row>>(initial);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'saved' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  function pickParticipant(lbl: string, key: string) {
    if (key === '') {
      // "Свой текст" — keep current name editable, clear userId.
      setRows((prev) => ({ ...prev, [lbl]: { ...prev[lbl]!, userId: null } }));
      return;
    }
    const p = participants.find((x) => x.key === key);
    if (!p) return;
    setRows((prev) => ({
      ...prev,
      [lbl]: { userId: p.userId, name: p.label },
    }));
  }

  function setName(lbl: string, name: string) {
    setRows((prev) => ({ ...prev, [lbl]: { ...prev[lbl]!, name } }));
  }

  function save() {
    setStatus({ kind: 'idle' });
    const map: Record<string, { userId: string | null; name: string }> = {};
    for (const [lbl, r] of Object.entries(rows)) {
      const trimmed = r.name.trim();
      if (!trimmed) continue;
      map[lbl] = { userId: r.userId, name: trimmed };
    }
    startTransition(async () => {
      const res = await setMeetingSpeakerMapAction({ meetingId, map });
      if (!res.ok) {
        setStatus({ kind: 'error', message: res.message });
        return;
      }
      setStatus({ kind: 'saved' });
      // The action revalidates the page; on next render saved props
      // arrive populated, so this editor stays in sync.
    });
  }

  function pickedKeyFor(row: Row): string {
    if (row.userId) {
      const match = participants.find((p) => p.userId === row.userId);
      if (match) return match.key;
    }
    return '';
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Спикеры</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          WhisperX размечает голоса как SPEAKER_00, SPEAKER_01, … Чтобы
          в саммари и в транскрипте появились настоящие имена — выберите
          участника или впишите своё.
        </p>
        <ul className="space-y-2">
          {labels.map((lbl) => {
            const row = rows[lbl]!;
            const pickedKey = pickedKeyFor(row);
            return (
              <li key={lbl} className="flex flex-wrap items-center gap-2">
                <code className="rounded bg-muted px-2 py-1 text-xs font-mono">{lbl}</code>
                <span className="text-xs text-muted-foreground">→</span>
                <select
                  value={pickedKey}
                  onChange={(e) => pickParticipant(lbl, e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  disabled={pending}
                >
                  <option value="">— свой текст —</option>
                  {participants.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <Input
                  value={row.name}
                  onChange={(e) => setName(lbl, e.target.value)}
                  disabled={pending}
                  className="w-56"
                  maxLength={80}
                />
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" onClick={save} disabled={pending}>
            {pending ? 'Сохраняю…' : 'Сохранить'}
          </Button>
          {status.kind === 'saved' ? (
            <span className="text-xs text-emerald-600">Сохранено</span>
          ) : null}
          {status.kind === 'error' ? (
            <span className="text-xs text-destructive">{status.message}</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
