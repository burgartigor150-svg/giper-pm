import { notFound } from 'next/navigation';
import { prisma } from '@giper/db';
import { GuestJoinFlow } from '@/components/domain/GuestJoinFlow';

export const dynamic = 'force-dynamic';

/**
 * Public guest-landing page. The URL path carries an unguessable
 * 256-bit token; we validate it server-side before exposing anything,
 * so a 404 on a wrong token never leaks meeting metadata.
 *
 * The actual LiveKit JWT is minted by joinMeetingAsGuestAction inside
 * <GuestJoinFlow> after the guest types their display name — we don't
 * mint it here because that would consume one of the maxUses slots
 * before the guest has decided to actually join.
 */
export default async function MeetingGuestPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await prisma.meetingInvite.findUnique({
    where: { token },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      maxUses: true,
      usedCount: true,
      meeting: { select: { id: true, title: true, status: true } },
    },
  });
  if (!invite) notFound();
  if (invite.revokedAt) {
    return <GuestErrorCard message="Ссылка была отозвана." />;
  }
  if (invite.expiresAt < new Date()) {
    return <GuestErrorCard message="Срок действия ссылки истёк." />;
  }
  if (invite.maxUses != null && invite.usedCount >= invite.maxUses) {
    return <GuestErrorCard message="Лимит подключений по этой ссылке исчерпан." />;
  }
  const m = invite.meeting;
  if (!m) notFound();
  if (m.status === 'ENDED' || m.status === 'PROCESSING' || m.status === 'READY') {
    return <GuestErrorCard message="Встреча уже завершилась." />;
  }

  return <GuestJoinFlow token={token} />;
}

function GuestErrorCard({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-3 rounded-lg border border-destructive/30 bg-card p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold">Не получилось войти</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <p className="text-xs text-muted-foreground">
          Попросите организатора прислать новую ссылку.
        </p>
      </div>
    </div>
  );
}
