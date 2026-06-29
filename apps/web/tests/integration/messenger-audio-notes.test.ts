import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Slice 7 — sendAudioNoteAction: voice messages. Server contract: audio mime
 * only, size + duration caps, kind=AUDIO_NOTE with durationSec, access-gated.
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
  buildMessageFileKey: (channelId: string, filename: string) => `messages/${channelId}/2026/06/test-${filename}`,
}));

import { prisma } from '@giper/db';
import { sendAudioNoteAction, createChannelAction } from '@/actions/messenger';
import { makeUser } from './helpers/factories';

beforeEach(() => {
  mockMe.id = '';
  mockMe.role = 'MEMBER';
});

async function setupChannel() {
  const owner = await makeUser();
  mockMe.id = owner.id;
  const res = await createChannelAction({ name: `a-${Date.now()}-${Math.random()}`, kind: 'PUBLIC' });
  if (!res.ok || !res.data) throw new Error('setup failed');
  return { channelId: res.data.id };
}

function fd(input: Record<string, string | Blob>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(input)) f.set(k, v);
  return f;
}

function audioBlob(size = 50_000, type = 'audio/webm'): Blob {
  return new Blob([new Uint8Array(size)], { type });
}

describe('sendAudioNoteAction — validation', () => {
  it('rejects missing file, non-audio mime, bad duration, and over-length', async () => {
    const { channelId } = await setupChannel();
    expect(await sendAudioNoteAction(fd({ channelId, duration: '5' }))).toMatchObject({ ok: false });
    expect(
      await sendAudioNoteAction(fd({ channelId, file: audioBlob(100, 'video/webm'), mime: 'video/webm', duration: '5' })),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    for (const bad of ['0', '-1', 'NaN', '']) {
      expect(
        await sendAudioNoteAction(fd({ channelId, file: audioBlob(), mime: 'audio/webm', duration: bad })),
      ).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    }
    expect(
      await sendAudioNoteAction(fd({ channelId, file: audioBlob(), mime: 'audio/webm', duration: '999' })),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });
});

describe('sendAudioNoteAction — happy path', () => {
  it('creates a Message + AUDIO_NOTE attachment with rounded duration', async () => {
    const { channelId } = await setupChannel();
    const r = await sendAudioNoteAction(
      fd({ channelId, file: audioBlob(80_000, 'audio/webm;codecs=opus'), mime: 'audio/webm;codecs=opus', duration: '12.6' }),
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.data) {
      const att = await prisma.messageAttachment.findFirst({ where: { messageId: r.data.id } });
      expect(att?.kind).toBe('AUDIO_NOTE');
      expect(att?.durationSec).toBe(13);
      expect(att?.mimeType).toBe('audio/webm;codecs=opus');
      expect(att?.storageKey).toContain('voice.webm');
    }
  });

  it('maps audio/mp4 to an .m4a extension', async () => {
    const { channelId } = await setupChannel();
    const r = await sendAudioNoteAction(fd({ channelId, file: audioBlob(10_000, 'audio/mp4'), mime: 'audio/mp4', duration: '3' }));
    expect(r.ok).toBe(true);
    if (r.ok && r.data) {
      const att = await prisma.messageAttachment.findFirst({ where: { messageId: r.data.id } });
      expect(att?.storageKey.endsWith('voice.m4a')).toBe(true);
    }
  });
});
