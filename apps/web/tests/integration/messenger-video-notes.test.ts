import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Server-side validation for video-note uploads. The client is the
 * UX layer — these tests pin the server contract that protects the
 * storage backend from oversized / wrong-mime / spoofed-duration
 * uploads.
 *
 * We don't actually write to S3 here. The first reject-on-validation
 * path bails before any `putObject`, so the test doesn't need a real
 * bucket. The "happy path" is covered by mocking the storage layer.
 */

const mockMe = {
  id: '',
  role: 'MEMBER' as 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER',
  name: 'A',
  email: 'a@a',
  image: null,
  mustChangePassword: false,
};

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => mockMe),
  requireRole: vi.fn(async () => mockMe),
  signOut: vi.fn(),
  signIn: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// Storage: stub out put / buildKey so the happy-path test doesn't
// need a live MinIO. Both functions are imported lazily inside the
// action — the dynamic import resolves to this mock.
vi.mock('@/lib/storage/s3', () => ({
  putObject: vi.fn(async () => undefined),
  buildVideoNoteKey: (channelId: string, ext: string) =>
    `messages/${channelId}/2026/05/video-note-test.${ext}`,
}));
// Realtime publishing isn't relevant for these tests.
vi.mock('@/lib/realtime/publishChat', () => ({
  publishChatEvent: vi.fn(async () => undefined),
}));

import { prisma } from '@giper/db';
import { sendVideoNoteAction, createChannelAction } from '@/actions/messenger';
import { makeUser } from './helpers/factories';

beforeEach(() => {
  mockMe.id = '';
  mockMe.role = 'MEMBER';
});

async function setupChannel() {
  const owner = await makeUser();
  mockMe.id = owner.id;
  const res = await createChannelAction({
    name: `vn-${Date.now()}-${Math.random()}`,
    kind: 'PUBLIC',
  });
  if (!res.ok || !res.data) throw new Error('setup failed');
  return { owner, channelId: res.data.id };
}

function fd(input: Record<string, string | Blob>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(input)) f.set(k, v);
  return f;
}

function videoBlob({
  size = 100_000,
  type = 'video/webm',
}: {
  size?: number;
  type?: string;
} = {}): Blob {
  return new Blob([new Uint8Array(size)], { type });
}

describe('sendVideoNoteAction — validation', () => {
  it('rejects missing file', async () => {
    const { channelId } = await setupChannel();
    const r = await sendVideoNoteAction(fd({ channelId, duration: '5', width: '480', height: '480' }));
    expect(r).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('rejects empty file (0 bytes)', async () => {
    const { channelId } = await setupChannel();
    const r = await sendVideoNoteAction(
      fd({
        channelId,
        file: videoBlob({ size: 0 }),
        duration: '5',
        width: '480',
        height: '480',
      }),
    );
    expect(r).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('rejects file > 8 MB', async () => {
    const { channelId } = await setupChannel();
    const r = await sendVideoNoteAction(
      fd({
        channelId,
        file: videoBlob({ size: 9 * 1024 * 1024 }),
        duration: '60',
        width: '480',
        height: '480',
      }),
    );
    expect(r).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('rejects non-video mime', async () => {
    const { channelId } = await setupChannel();
    const r = await sendVideoNoteAction(
      fd({
        channelId,
        file: videoBlob({ type: 'application/octet-stream' }),
        duration: '5',
        width: '480',
        height: '480',
      }),
    );
    expect(r).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('rejects duration > 60s (client cap evaded)', async () => {
    const { channelId } = await setupChannel();
    const r = await sendVideoNoteAction(
      fd({
        channelId,
        file: videoBlob(),
        duration: '120',
        width: '480',
        height: '480',
      }),
    );
    expect(r).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('rejects zero / negative / non-numeric duration', async () => {
    const { channelId } = await setupChannel();
    for (const bad of ['0', '-3', 'NaN', '']) {
      const r = await sendVideoNoteAction(
        fd({
          channelId,
          file: videoBlob(),
          duration: bad,
          width: '480',
          height: '480',
        }),
      );
      expect(r).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    }
  });

  it('rejects without channel access (non-member of PRIVATE)', async () => {
    const owner = await makeUser();
    mockMe.id = owner.id;
    const peer = await makeUser();
    const ch = await createChannelAction({
      name: `priv-${Date.now()}-${Math.random()}`,
      kind: 'PRIVATE',
      memberUserIds: [peer.id],
    });
    if (!ch.ok || !ch.data) throw new Error('setup failed');

    const stranger = await makeUser();
    mockMe.id = stranger.id;
    const r = await sendVideoNoteAction(
      fd({
        channelId: ch.data.id,
        file: videoBlob(),
        duration: '5',
        width: '480',
        height: '480',
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(['NOT_FOUND', 'FORBIDDEN']).toContain(r.error.code);
  });
});

describe('sendVideoNoteAction — happy path', () => {
  it('creates Message + MessageAttachment(kind=VIDEO_NOTE) with capped duration', async () => {
    const { channelId } = await setupChannel();
    const r = await sendVideoNoteAction(
      fd({
        channelId,
        file: videoBlob({ size: 500_000, type: 'video/webm' }),
        duration: '42.7',
        width: '480',
        height: '480',
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.data) {
      const msg = await prisma.message.findUnique({
        where: { id: r.data.id },
        include: { attachments: true },
      });
      expect(msg?.body).toBe('');
      expect(msg?.attachments).toHaveLength(1);
      const att = msg!.attachments[0]!;
      expect(att.kind).toBe('VIDEO_NOTE');
      // 42.7 → rounded to 43.
      expect(att.durationSec).toBe(43);
      expect(att.width).toBe(480);
      expect(att.height).toBe(480);
      expect(att.mimeType).toBe('video/webm');
      expect(att.storageKey).toContain('messages/');
    }
  });

  it('uses .mp4 extension when the blob is video/mp4', async () => {
    const { channelId } = await setupChannel();
    const r = await sendVideoNoteAction(
      fd({
        channelId,
        file: videoBlob({ type: 'video/mp4' }),
        duration: '5',
        width: '480',
        height: '480',
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.data) {
      const att = await prisma.messageAttachment.findFirst({
        where: { messageId: r.data.id },
      });
      expect(att?.storageKey.endsWith('.mp4')).toBe(true);
      expect(att?.filename).toBe('video-note.mp4');
    }
  });

  it('honours the explicit `mime` form field when Blob.type is flattened to text/plain', async () => {
    // Regression for the production bug where React Server Action
    // FormData serialization dropped the Blob's Content-Type and
    // the server saw `text/plain` instead of `video/webm`. The
    // recorder also passes the mime as an explicit field; this
    // test pins that path.
    const { channelId } = await setupChannel();
    const r = await sendVideoNoteAction(
      fd({
        channelId,
        // Blob.type is the wrong one — simulating the SA transport bug.
        file: videoBlob({ type: 'text/plain' }),
        mime: 'video/webm',
        duration: '5',
        width: '480',
        height: '480',
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.data) {
      const att = await prisma.messageAttachment.findFirst({
        where: { messageId: r.data.id },
      });
      expect(att?.mimeType).toBe('video/webm');
      expect(att?.storageKey.endsWith('.webm')).toBe(true);
    }
  });

  it('clamps duration to 60 even at the +0.5s grace boundary', async () => {
    const { channelId } = await setupChannel();
    const r = await sendVideoNoteAction(
      fd({
        channelId,
        file: videoBlob(),
        duration: '60.3',
        width: '480',
        height: '480',
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.data) {
      const att = await prisma.messageAttachment.findFirst({
        where: { messageId: r.data.id },
      });
      expect(att?.durationSec).toBe(60);
    }
  });
});
