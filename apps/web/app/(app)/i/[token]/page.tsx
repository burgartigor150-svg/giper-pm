import Link from 'next/link';
import { previewChannelInviteAction } from '@/actions/messenger';
import { InviteAcceptButton } from './InviteAcceptButton';

type Params = Promise<{ token: string }>;

/**
 * Landing for /i/<token>. Resolves the invite, shows a Telegram-style
 * preview, and offers a single button to join. Auth is enforced by the
 * (app) layout — anonymous users get bounced to /login and come back
 * here with the original URL preserved.
 */
export default async function InviteLandingPage({ params }: { params: Params }) {
  const { token } = await params;
  const r = await previewChannelInviteAction(token);

  if (!r.ok) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-16 text-center">
        <h1 className="text-lg font-semibold">Ссылка недоступна</h1>
        <p className="text-sm text-muted-foreground">{r.error.message}</p>
        <Link
          href="/messages"
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted"
        >
          К сообщениям
        </Link>
      </div>
    );
  }

  const { channelName, memberCount, isValid, reason, channelKind } = r.data;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-16 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-muted text-2xl font-semibold">
        {channelName.charAt(0).toUpperCase()}
      </div>
      <div>
        <h1 className="text-lg font-semibold">{channelName}</h1>
        <p className="text-xs text-muted-foreground">
          {channelKind === 'PRIVATE' ? 'Приватный канал' : 'Канал'} · {memberCount}{' '}
          {memberCount === 1 ? 'участник' : 'участников'}
        </p>
      </div>
      {isValid ? (
        <InviteAcceptButton token={token} />
      ) : (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          {reason ?? 'Ссылка недействительна'}
        </p>
      )}
      <Link
        href="/messages"
        className="text-xs text-muted-foreground hover:text-foreground hover:underline"
      >
        Отмена
      </Link>
    </div>
  );
}
