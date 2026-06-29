import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Security contract for the messenger attachment proxy
 * (apps/web/app/api/messages/attachments/[id]/route.ts):
 * hostile/mislabelled uploads must never be served inline in our origin.
 * Safe media (images/pdf/video/audio notes) stay inline; everything else is
 * forced to download as octet-stream + nosniff + CSP sandbox.
 *
 * S3 is mocked so no live MinIO is needed; access + headers are the contract.
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
vi.mock('@/lib/storage/s3', () => ({
  getObjectStream: vi.fn(async () => ({
    Body: new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array([1, 2, 3]));
        c.close();
      },
    }),
    ContentLength: 3,
    ContentType: undefined,
    AcceptRanges: 'bytes',
    ContentRange: undefined,
  })),
}));

import { prisma } from '@giper/db';
import { GET } from '@/app/api/messages/attachments/[id]/route';
import { createChannelAction } from '@/actions/messenger';
import { makeUser } from './helpers/factories';

beforeEach(() => {
  mockMe.id = '';
  mockMe.role = 'MEMBER';
});

async function setup(mimeType: string, kind: 'FILE' | 'IMAGE' | 'VIDEO_NOTE' | 'AUDIO_NOTE', filename: string) {
  const owner = await makeUser();
  mockMe.id = owner.id;
  const ch = await createChannelAction({ name: `att-${Date.now()}-${Math.random()}`, kind: 'PUBLIC' });
  if (!ch.ok || !ch.data) throw new Error('channel setup failed');
  const msg = await prisma.message.create({
    data: { channelId: ch.data.id, authorId: owner.id, body: 'x' },
  });
  const att = await prisma.messageAttachment.create({
    data: {
      messageId: msg.id,
      filename,
      mimeType,
      sizeBytes: 3,
      storageKey: `messages/${ch.data.id}/x`,
      kind,
    },
  });
  return att.id;
}

function call(id: string) {
  return GET(new Request(`http://test.local/api/messages/attachments/${id}`), {
    params: Promise.resolve({ id }),
  });
}

describe('messenger attachment route — inline-safety headers', () => {
  it('serves a PNG inline with nosniff and no sandbox CSP', async () => {
    const id = await setup('image/png', 'IMAGE', 'pic.png');
    const res = await call(id);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBeNull();
  });

  it('forces an SVG to download as octet-stream + attachment + sandbox CSP', async () => {
    const id = await setup('image/svg+xml', 'FILE', 'evil.svg');
    const res = await call(id);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
  });

  it('forces text/html to download (no same-origin script execution)', async () => {
    const id = await setup('text/html', 'FILE', 'page.html');
    const res = await call(id);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
  });

  it('keeps video notes inline (no regression) with nosniff', async () => {
    const id = await setup('video/webm', 'VIDEO_NOTE', 'video-note.webm');
    const res = await call(id);
    expect(res.headers.get('content-type')).toBe('video/webm');
    expect(res.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBeNull();
  });

  it('keeps audio notes inline', async () => {
    const id = await setup('audio/webm', 'AUDIO_NOTE', 'voice.webm');
    const res = await call(id);
    expect(res.headers.get('content-type')).toBe('audio/webm');
    expect(res.headers.get('content-disposition')).toMatch(/^inline;/);
  });

  it('403s a non-member of a private channel', async () => {
    const owner = await makeUser();
    mockMe.id = owner.id;
    const peer = await makeUser();
    const ch = await createChannelAction({
      name: `priv-${Date.now()}-${Math.random()}`,
      kind: 'PRIVATE',
      memberUserIds: [peer.id],
    });
    if (!ch.ok || !ch.data) throw new Error('setup failed');
    const msg = await prisma.message.create({ data: { channelId: ch.data.id, authorId: owner.id, body: 'x' } });
    const att = await prisma.messageAttachment.create({
      data: { messageId: msg.id, filename: 'a.png', mimeType: 'image/png', sizeBytes: 3, storageKey: 'k', kind: 'IMAGE' },
    });
    const stranger = await makeUser();
    mockMe.id = stranger.id;
    const res = await call(att.id);
    expect(res.status).toBe(403);
  });
});
