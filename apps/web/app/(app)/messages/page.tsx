import { requireAuth } from '@/lib/auth';
import { listMyChannels } from '@/actions/messenger';
import { MessagesShell } from '@/components/domain/messenger/MessagesShell';

/**
 * Messenger root. With no channel selected we land on a hint screen;
 * once a channel is picked we redirect to /messages/<channelId> which
 * renders the same shell with the chat pane filled in.
 */
export default async function MessagesIndexPage() {
  await requireAuth();
  const { memberChannels, publicChannels } = await listMyChannels();
  return (
    <MessagesShell
      memberChannels={memberChannels}
      publicChannels={publicChannels}
      activeChannelId={null}
    />
  );
}
