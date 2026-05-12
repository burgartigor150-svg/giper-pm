'use client';

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from 'react';
import { Send, Camera } from 'lucide-react';
import { Avatar } from '@giper/ui/components/Avatar';
import { Button } from '@giper/ui/components/Button';
import { searchUsersForMention } from '@/actions/messenger';
import { VideoNoteRecorder } from './VideoNoteRecorder';

type MentionUser = {
  id: string;
  name: string;
  email: string | null;
  image: string | null;
};

type Props = {
  placeholder: string;
  disabled?: boolean;
  onSend: (body: string) => Promise<void> | void;
  /**
   * Context required by attachments-style sub-flows (currently just
   * video-notes). When omitted the camera button is hidden — DM
   * /redirect pages and other "use the composer as text input"
   * call-sites pass only `onSend` and skip these.
   */
  channelId?: string;
  parentId?: string | null;
  /** Called after a video-note finishes uploading. Same intent as
   *  `onSend` returning — caller revalidates / refreshes. */
  onVideoNoteSent?: () => void;
};

/**
 * Composer with @mention autocomplete. Detects an active "@" trigger
 * by scanning back from the caret to the most recent space/newline;
 * the substring after "@" is the live filter. Selecting a user
 * replaces "@<filter>" with "@<userId> " (the canonical mention token
 * understood by the server-side parser and the renderer).
 */
export function MessageComposer({
  placeholder,
  disabled,
  onSend,
  channelId,
  parentId = null,
  onVideoNoteSent,
}: Props) {
  const [draft, setDraft] = useState('');
  const [pending, startTransition] = useTransition();
  const [recorderOpen, setRecorderOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const [mentionState, setMentionState] = useState<{
    query: string;
    triggerAt: number; // index of the '@' in the textarea
  } | null>(null);
  const [matches, setMatches] = useState<MentionUser[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);

  // Debounced fetch of mention candidates. Empty query is supported —
  // the server returns an alphabetised top-8 of active users, so the
  // popup appears immediately on '@' even before any letter is typed
  // (matches Slack/Discord behaviour).
  useEffect(() => {
    if (!mentionState) {
      setMatches([]);
      return;
    }
    const q = mentionState.query;
    const t = setTimeout(async () => {
      // Mentions can target anyone in the org (incl. Bitrix-mirrored
      // stub accounts) — they'll see the ping next time they sign in.
      const users = await searchUsersForMention(q || ' ', { includeInactive: true });
      setMatches(users);
      setActiveIdx(0);
    }, 100);
    return () => clearTimeout(t);
  }, [mentionState?.query, mentionState]);

  function recomputeMentionTrigger(text: string, caret: number) {
    // Walk back from caret to find the most recent '@' not preceded by
    // a word character. Stop on whitespace or start of string.
    let i = caret - 1;
    while (i >= 0) {
      const ch = text[i]!;
      if (ch === '@') {
        const prev = i === 0 ? ' ' : text[i - 1]!;
        if (/\s/.test(prev)) {
          const query = text.slice(i + 1, caret);
          // Only show popup while the typed token has no space yet.
          if (!/\s/.test(query) && query.length <= 30) {
            setMentionState({ query, triggerAt: i });
            return;
          }
        }
        break;
      }
      if (/\s/.test(ch)) break;
      i--;
    }
    setMentionState(null);
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value;
    setDraft(text);
    recomputeMentionTrigger(text, e.target.selectionStart);
  }

  function pickMention(user: MentionUser) {
    if (!mentionState) return;
    const before = draft.slice(0, mentionState.triggerAt);
    const after = draft.slice(
      mentionState.triggerAt + 1 + mentionState.query.length,
    );
    const insert = `@${user.id} `;
    const next = before + insert + after;
    setDraft(next);
    setMentionState(null);
    setMatches([]);
    // Restore caret right after the inserted token.
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (ta) {
        const pos = before.length + insert.length;
        ta.focus();
        ta.setSelectionRange(pos, pos);
      }
    });
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionState && matches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickMention(matches[activeIdx]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionState(null);
        setMatches([]);
        return;
      }
    }
    // Send on plain Enter, newline on Shift+Enter.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  async function send() {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    setMentionState(null);
    setMatches([]);
    startTransition(async () => {
      try {
        await onSend(body);
      } catch {
        // Restore draft on failure so the user can retry.
        setDraft(body);
      }
    });
  }

  // Recorder takes over the whole composer area while active. Once
  // the upload finishes we tear it down and bubble the "refresh"
  // signal up so the chat list re-renders the new message.
  if (recorderOpen && channelId) {
    return (
      <VideoNoteRecorder
        channelId={channelId}
        parentId={parentId}
        onSent={() => {
          setRecorderOpen(false);
          onVideoNoteSent?.();
        }}
        onClose={() => setRecorderOpen(false)}
      />
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      className="relative flex items-end gap-2"
    >
      <div className="relative flex-1">
        <textarea
          ref={taRef}
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKey}
          onSelect={(e) => {
            const target = e.target as HTMLTextAreaElement;
            recomputeMentionTrigger(target.value, target.selectionStart);
          }}
          placeholder={placeholder}
          rows={1}
          disabled={disabled || pending}
          className="min-h-[40px] w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        {mentionState && matches.length > 0 ? (
          <div className="absolute bottom-full left-0 z-30 mb-1 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-popover py-1 shadow-md">
            <ul>
              {matches.map((u, i) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickMention(u)}
                    className={`flex w-full items-center gap-2 px-2 py-1 text-left text-sm ${
                      i === activeIdx ? 'bg-accent' : 'hover:bg-accent'
                    }`}
                  >
                    <Avatar src={u.image} alt={u.name} className="h-5 w-5" />
                    <span className="flex-1 truncate">{u.name}</span>
                    {u.email ? (
                      <span className="truncate text-[10px] text-muted-foreground">
                        {u.email}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {channelId ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={pending || disabled}
          onClick={() => setRecorderOpen(true)}
          aria-label="Записать видеосообщение"
          title="Видеосообщение (до 60 сек)"
        >
          <Camera className="size-4" />
        </Button>
      ) : null}
      <Button
        type="submit"
        disabled={pending || disabled || !draft.trim()}
        size="icon"
      >
        <Send className="size-4" />
      </Button>
    </form>
  );
}
