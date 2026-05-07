import { redirect } from 'next/navigation';
import { requireAuth } from '@/lib/auth';
import { getOrCreateDmAction } from '@/actions/messenger';

type Params = Promise<{ userId: string }>;

/**
 * /messages/dm/<userId> — opens (or creates) a 1-1 DM channel with that
 * user and redirects to /messages/<channelId>. Used as the click target
 * for @mention pills so a click jumps straight into a private chat.
 */
export default async function DmRedirectPage({ params }: { params: Params }) {
  const { userId } = await params;
  await requireAuth();
  const res = await getOrCreateDmAction(userId);
  if (!res.ok || !res.data) {
    redirect('/messages');
  }
  redirect(`/messages/${res.data.id}`);
}
