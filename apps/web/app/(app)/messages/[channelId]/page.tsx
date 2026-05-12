import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/auth';
import { listMyChannels } from '@/actions/messenger';
import { loadChannelMessages } from '@/lib/messenger/queries';
import { MessagesShell } from '@/components/domain/messenger/MessagesShell';

type Params = Promise<{ channelId: string }>;

export default async function MessagesChannelPage({ params }: { params: Params }) {
  const { channelId } = await params;
  const me = await requireAuth();

  const [{ memberChannels, publicChannels }, loaded] = await Promise.all([
    listMyChannels(),
    loadChannelMessages(channelId, me.id, { limit: 80 }),
  ]);
  if (!loaded) notFound();

  return (
    <MessagesShell
      memberChannels={memberChannels}
      publicChannels={publicChannels}
      activeChannelId={channelId}
      // newest-first → reverse for top-to-bottom chronological render.
      initialMessages={[...loaded.messages].reverse()}
      mentionedUsers={loaded.mentionedUsers}
      taskPreviews={loaded.taskPreviews}
      meId={me.id}
      myChannelRole={loaded.access.role}
      isMuted={loaded.access.isMuted}
      canDeleteChannel={loaded.access.createdById === me.id}
    />
  );
}
