'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { Lock, Globe } from 'lucide-react';
import { Avatar } from '@giper/ui/components/Avatar';
import { Button } from '@giper/ui/components/Button';
import { addCommentAction, type ActionResult } from '@/actions/tasks';
import { searchUsersForMention } from '@/actions/messenger';
import { useT } from '@/lib/useT';

type MentionUser = {
  id: string;
  name: string;
  email: string | null;
  image: string | null;
};

const initial: ActionResult = { ok: true };

type Props = {
  taskId: string;
  projectKey: string;
  taskNumber: number;
  /**
   * When the parent task is mirrored from an external system (e.g.
   * Bitrix24), EXTERNAL comments are pushed to that system and visible
   * to the client. INTERNAL comments stay local. Hide the toggle for
   * non-mirrored tasks — there's no client-facing "external" channel.
   */
  showVisibilityToggle?: boolean;
  /** Initial visibility — driven by the active tab in the parent timeline. */
  defaultVisibility?: 'EXTERNAL' | 'INTERNAL';
};

export function CommentForm({
  taskId,
  projectKey,
  taskNumber,
  showVisibilityToggle = false,
  defaultVisibility = 'EXTERNAL',
}: Props) {
  const t = useT('tasks.detail');
  const action = addCommentAction.bind(null, taskId, projectKey, taskNumber);
  const [state, formAction, pending] = useActionState(action, initial);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [visibility, setVisibility] = useState<'EXTERNAL' | 'INTERNAL'>(
    defaultVisibility,
  );
  // Track parent's tab change — when the user switches tabs we want
  // the form to follow without forcing a click on the visibility toggle.
  useEffect(() => {
    setVisibility(defaultVisibility);
  }, [defaultVisibility]);
  // Mention popup state.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionResults, setMentionResults] = useState<MentionUser[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);

  // Resolved mentions for the current draft. We display "@Имя" inline
  // in the textarea (much friendlier than a raw cuid like
  // "@cmovi9mz3009yr4mfvwhtunhf") and keep this map so we can rewrite
  // each "@Имя" back to "@<userId>" right before the form submits —
  // that's the canonical token the server-side parser expects.
  const [mentions, setMentions] = useState<
    Array<{ userId: string; label: string }>
  >([]);

  useEffect(() => {
    if (state && state.ok) {
      setText('');
      setMentions([]);
      if (taRef.current) taRef.current.value = '';
    }
  }, [state]);

  // Drop mentions whose label was edited away from the draft. Keeps
  // the resolution map honest as the user backspaces / rewrites the
  // text. Order is preserved.
  useEffect(() => {
    setMentions((prev) => prev.filter((m) => text.includes(m.label)));
  }, [text]);

  // Body that actually goes over the wire on submit. Replace each
  // "@Имя" pill text with "@<userId>" once. Sort by label length desc
  // so a long name ("@Иван Иванов") is replaced before the shorter
  // prefix ("@Иван") of another mention — avoids partial overwrites.
  const submittedBody = useMemo(() => {
    if (mentions.length === 0) return text;
    let out = text;
    const ordered = [...mentions].sort(
      (a, b) => b.label.length - a.label.length,
    );
    for (const m of ordered) {
      out = out.split(m.label).join(`@${m.userId}`);
    }
    return out;
  }, [text, mentions]);

  // Fetch mention candidates whenever the query changes. Empty query
  // is supported — server returns the top alphabetised users so the
  // popup pops immediately on `@` / `+` (Slack/Discord/Bitrix style).
  // includeInactive=true so Bitrix-mirrored stubs (no login) can be
  // pinged — they'll see it next time they sign in.
  useEffect(() => {
    if (mentionQuery === null) {
      setMentionResults([]);
      return;
    }
    const id = setTimeout(async () => {
      const q = mentionQuery.trim();
      const list = await searchUsersForMention(q || ' ', { includeInactive: true });
      setMentionResults(list);
      setMentionIndex(0);
    }, 100);
    return () => clearTimeout(id);
  }, [mentionQuery]);

  // Recompute mention popup state from the textarea's current state.
  // Triggers: `@` or `+` (mirrors the Bitrix UI hint "@ или +"),
  // followed by partial name letters. The trigger must follow
  // whitespace or be at the start of the input.
  function recomputeMention(value: string, caret: number) {
    // Walk backwards from caret over name-like characters to find the
    // trigger character.
    let i = caret - 1;
    while (i >= 0 && /[\p{L}\p{N}_.-]/u.test(value[i] ?? '')) i--;
    const trigger = value[i] ?? '';
    if (i < 0 || (trigger !== '@' && trigger !== '+')) {
      setMentionQuery(null);
      setMentionStart(null);
      return;
    }
    if (i > 0 && !/\s/.test(value[i - 1] ?? '')) {
      setMentionQuery(null);
      setMentionStart(null);
      return;
    }
    setMentionStart(i);
    setMentionQuery(value.slice(i + 1, caret));
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setText(value);
    recomputeMention(value, e.target.selectionStart ?? value.length);
  }

  function onSelectCaret(e: React.SyntheticEvent<HTMLTextAreaElement>) {
    const target = e.currentTarget;
    recomputeMention(target.value, target.selectionStart ?? 0);
  }

  function pickMention(user: MentionUser) {
    if (mentionStart === null || !taRef.current) return;
    const ta = taRef.current;
    const before = text.slice(0, mentionStart);
    const after = text.slice(ta.selectionStart ?? text.length);
    // Show the human name, not the cuid. The map above rewrites the
    // label back to the id token at submit time.
    const label = `@${user.name}`;
    const insert = `${label} `;
    const next = before + insert + after;
    setText(next);
    ta.value = next;
    setMentions((prev) => {
      // De-dupe per label — a 2nd insertion of the same name reuses
      // the existing entry.
      if (prev.some((m) => m.userId === user.id && m.label === label)) {
        return prev;
      }
      return [...prev, { userId: user.id, label }];
    });
    requestAnimationFrame(() => {
      const pos = before.length + insert.length;
      ta.setSelectionRange(pos, pos);
      ta.focus();
    });
    setMentionQuery(null);
    setMentionStart(null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery !== null) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        setMentionStart(null);
        return;
      }
      if (mentionResults.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMentionIndex((i) => (i + 1) % mentionResults.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMentionIndex(
            (i) => (i - 1 + mentionResults.length) % mentionResults.length,
          );
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          const pick = mentionResults[mentionIndex];
          if (pick) {
            e.preventDefault();
            pickMention(pick);
            return;
          }
        }
      }
    }
  }

  const isInternal = visibility === 'INTERNAL';
  const showPopup = mentionQuery !== null;

  return (
    <form action={formAction} className="relative flex flex-col gap-2">
      {showVisibilityToggle ? <input type="hidden" name="visibility" value={visibility} /> : null}
      {/*
        Wire the body field via a hidden input so the value the server
        sees is the mention-resolved one ("@<userId>"), not the
        human-friendly text shown in the textarea ("@Имя").
        The textarea has no `name` so it isn't included in FormData.
      */}
      <input type="hidden" name="body" value={submittedBody} />
      <textarea
        ref={taRef}
        value={text}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onSelect={onSelectCaret}
        placeholder="Нажмите @ или + чтобы упомянуть человека"
        required
        className={
          'min-h-[80px] rounded-md border bg-background px-3 py-2 text-sm transition-colors ' +
          (isInternal
            ? 'border-amber-300 bg-amber-50/50 focus:ring-amber-200'
            : 'border-input')
        }
      />
      {showPopup ? (
        <div className="absolute left-2 top-full z-30 mt-1 max-h-72 w-80 overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-lg">
          {mentionResults.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {mentionQuery
                ? `Никого не найдено по «${mentionQuery}»`
                : 'Загрузка…'}
            </div>
          ) : (
            <ul>
              {mentionResults.map((u, i) => (
                <li key={u.id}>
                  <button
                    type="button"
                    // Pointer-down rather than click — click fires after blur,
                    // and blur would reset the popup state before pickMention runs.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickMention(u);
                    }}
                    className={
                      'flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm ' +
                      (i === mentionIndex ? 'bg-accent text-accent-foreground' : '')
                    }
                  >
                    <Avatar src={u.image} alt={u.name} className="h-6 w-6" />
                    <span className="flex-1 truncate">{u.name}</span>
                    {u.email ? (
                      <span className="text-[11px] text-muted-foreground truncate">
                        {u.email}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {state && !state.ok ? (
        <p className="text-xs text-destructive">{state.error.message}</p>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        {showVisibilityToggle ? (
          <button
            type="button"
            onClick={() =>
              setVisibility((v) => (v === 'EXTERNAL' ? 'INTERNAL' : 'EXTERNAL'))
            }
            className={
              'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ' +
              (isInternal
                ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                : 'border-input text-muted-foreground hover:bg-accent')
            }
            title={
              isInternal
                ? 'Внутренний комментарий — виден только в giper-pm'
                : 'Внешний комментарий — улетит в Bitrix к заказчику'
            }
          >
            {isInternal ? (
              <>
                <Lock className="h-3 w-3" />
                Внутренний
              </>
            ) : (
              <>
                <Globe className="h-3 w-3" />
                Внешний
              </>
            )}
          </button>
        ) : (
          <span />
        )}
        <Button type="submit" size="sm" disabled={pending}>
          {t('addComment')}
        </Button>
      </div>
    </form>
  );
}
