import { publishRealtime } from '@giper/realtime/server';
import { channelForChat, channelForUser } from '@giper/realtime';

export type ChatEvent =
  | { kind: 'message.new'; channelId: string; messageId: string; authorId: string; parentId: string | null }
  | { kind: 'message.edited'; channelId: string; messageId: string }
  | { kind: 'message.deleted'; channelId: string; messageId: string }
  | { kind: 'reaction.changed'; channelId: string; messageId: string; userId: string; emoji: string; added: boolean }
  | { kind: 'channel.read'; channelId: string; userId: string };

/**
 * Fire-and-forget WS publish. Mirrors publishTaskEvent: never throws,
 * so a transient WS-layer failure can't fail the originating mutation.
 * Routes to the per-channel topic; per-user topics get dispatched
 * separately for inbox-style notifications (mentions, DM pings).
 */
export async function publishChatEvent(event: ChatEvent, opts?: {
  notifyUserIds?: string[];
}): Promise<void> {
  const targets: Array<{ channel: string }> = [{ channel: channelForChat(event.channelId) }];
  for (const uid of opts?.notifyUserIds ?? []) {
    targets.push({ channel: channelForUser(uid) });
  }
  await Promise.allSettled(
    targets.map((t) => publishRealtime({ channel: t.channel, payload: event })),
  );
}
