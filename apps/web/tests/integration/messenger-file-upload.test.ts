import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Slice 6 — sendFileAction: generic file + image upload. Server contract that
 * protects storage from oversized / disallowed uploads and records the right
 * attachment kind (IMAGE inline vs FILE download).
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
vi.mock('@/lib/realtime/publishChat', () => ({ publishChatEvent: vi.fn(async () => undefined) }));
vi.mock('@/lib/push/sendPush', () => ({ sendPushToUsers: vi.fn(async () => undefined) }));
vi.mock('@/lib/storage/s3', () => ({
  putObject: vi.fn(async () => undefined),
  buildMessageFileKey: (channelId: string, filename: string) =>
    `messages/${channelId}/2026/06/test-${filename}`,
}));

import { prisma } from '@giper/db';
import { sendFileAction, createChannelAction } from '@/actions/messenger';
import { makeUser } from './helpers/factories';

beforeEach(() => {
  mockMe.id = '';
  mockMe.role = 'MEMBER';
});

async function setupChannel() {
  const owner = await makeUser();
  mockMe.id = owner.id;
  const res = await createChannelAction({ name: `f-${Date.now()}-${Math.random()}`, kind: 'PUBLIC' });
  if (!res.ok || !res.data) throw new Error('setup failed');
  return { owner, channelId: res.data.id };
}

function fd(input: Record<string, string | Blob>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(input)) f.set(k, v);
  return f;
}

function blob(size: number, type: string): Blob {
  return new Blob([new Uint8Array(size)], { type });
}

describe('sendFileAction — validation', () => {
  it('rejects missing / empty / oversize files', async () => {
    const { channelId } = await setupChannel();
    expect(await sendFileAction(fd({ channelId }))).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(
      await sendFileAction(fd({ channelId, file: blob(0, 'image/png'), filename: 'a.png', mime: 'image/png' })),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(
      await sendFileAction(
        fd({ channelId, file: blob(26 * 1024 * 1024, 'application/pdf'), filename: 'big.pdf', mime: 'application/pdf' }),
      ),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('rejects a disallowed mime', async () => {
    const { channelId } = await setupChannel();
    const r = await sendFileAction(fd({ channelId, file: blob(100, 'foo/bar'), filename: 'x', mime: 'foo/bar' }));
    expect(r).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('rejects a non-member of a private channel', async () => {
    const owner = await makeUser();
    mockMe.id = owner.id;
    const peer = await makeUser();
    const ch = await createChannelAction({ name: `pf-${Date.now()}-${Math.random()}`, kind: 'PRIVATE', memberUserIds: [peer.id] });
    if (!ch.ok || !ch.data) throw new Error('setup');
    const stranger = await makeUser();
    mockMe.id = stranger.id;
    const r = await sendFileAction(fd({ channelId: ch.data.id, file: blob(100, 'image/png'), filename: 'a.png', mime: 'image/png' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(['NOT_FOUND', 'FORBIDDEN']).toContain(r.error.code);
  });
});

describe('sendFileAction — happy path', () => {
  it('stores an image as kind=IMAGE with dimensions', async () => {
    const { channelId } = await setupChannel();
    const r = await sendFileAction(
      fd({ channelId, file: blob(2048, 'image/png'), filename: 'shot.png', mime: 'image/png', width: '800', height: '600' }),
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.data) {
      const att = await prisma.messageAttachment.findFirst({ where: { messageId: r.data.id } });
      expect(att?.kind).toBe('IMAGE');
      expect(att?.mimeType).toBe('image/png');
      expect(att?.filename).toBe('shot.png');
      expect(att?.width).toBe(800);
      expect(att?.height).toBe(600);
      expect(att?.storageKey).toContain('messages/');
    }
  });

  it('stores a PDF as kind=FILE (no dimensions)', async () => {
    const { channelId } = await setupChannel();
    const r = await sendFileAction(
      fd({ channelId, file: blob(4096, 'application/pdf'), filename: 'doc.pdf', mime: 'application/pdf' }),
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.data) {
      const att = await prisma.messageAttachment.findFirst({ where: { messageId: r.data.id } });
      expect(att?.kind).toBe('FILE');
      expect(att?.width).toBeNull();
      expect(att?.sizeBytes).toBe(4096);
    }
  });
});
