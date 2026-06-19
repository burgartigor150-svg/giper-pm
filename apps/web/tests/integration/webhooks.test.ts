import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration tests for outgoing webhooks:
 *   - isSafeWebhookUrl SSRF guard.
 *   - createWebhookAction validation + RBAC.
 *   - dispatchWebhooks delivery (subscribed only, signed, status persisted)
 *     and SSRF block at send time.
 *
 * Source: apps/web/lib/webhooks/*, apps/web/actions/webhooks.ts
 */

const mockMe = {
  id: '',
  role: 'ADMIN' as 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER',
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

import { prisma } from '@giper/db';
import { isSafeWebhookUrl } from '@/lib/webhooks/ssrfGuard';
import { dispatchWebhooks } from '@/lib/webhooks/dispatchWebhooks';
import { createWebhookAction } from '@/actions/webhooks';
import { makeUser, makeProject } from './helpers/factories';

const fetchMock = vi.fn(async () => ({ status: 200 }) as unknown as Response);

beforeEach(() => {
  mockMe.role = 'ADMIN';
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

describe('isSafeWebhookUrl', () => {
  it('allows public https URLs', () => {
    expect(isSafeWebhookUrl('https://example.com/hook')).toBe(true);
    expect(isSafeWebhookUrl('https://hooks.slack.com/services/x')).toBe(true);
  });
  it('blocks localhost / private / metadata / non-http', () => {
    expect(isSafeWebhookUrl('http://example.com/x')).toBe(true); // http allowed by guard; the action requires https
    expect(isSafeWebhookUrl('http://localhost/x')).toBe(false);
    expect(isSafeWebhookUrl('https://localhost/x')).toBe(false);
    expect(isSafeWebhookUrl('https://127.0.0.1/x')).toBe(false);
    expect(isSafeWebhookUrl('https://10.0.0.5/x')).toBe(false);
    expect(isSafeWebhookUrl('https://192.168.1.1/x')).toBe(false);
    expect(isSafeWebhookUrl('https://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isSafeWebhookUrl('ftp://example.com')).toBe(false);
  });
});

describe('createWebhookAction', () => {
  it('creates a webhook and returns a one-time secret', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });

    const res = await createWebhookAction(project.id, 'https://example.com/hook', ['task.created']);
    expect(res.ok).toBe(true);
    expect(res.ok && res.data?.secret).toMatch(/^[0-9a-f]{48}$/);

    const rows = await prisma.webhook.findMany({ where: { projectId: project.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.events).toEqual(['task.created']);
  });

  it('rejects non-https, internal URLs, empty events, unknown events', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });

    expect((await createWebhookAction(project.id, 'http://example.com/x', ['task.created'])).ok).toBe(false);
    expect((await createWebhookAction(project.id, 'https://127.0.0.1/x', ['task.created'])).ok).toBe(false);
    expect((await createWebhookAction(project.id, 'https://example.com/x', [])).ok).toBe(false);
    expect((await createWebhookAction(project.id, 'https://example.com/x', ['nope'])).ok).toBe(false);
  });
});

describe('dispatchWebhooks', () => {
  it('delivers to subscribed active hooks only, signed, and records status', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    await prisma.webhook.create({
      data: { projectId: project.id, url: 'https://example.com/a', secret: 's', events: ['task.created'], active: true },
    });
    await prisma.webhook.create({
      data: { projectId: project.id, url: 'https://example.com/b', secret: 's', events: ['card.moved'], active: true },
    });
    await prisma.webhook.create({
      data: { projectId: project.id, url: 'https://example.com/c', secret: 's', events: ['task.created'], active: false },
    });

    await dispatchWebhooks(project.id, 'task.created', { task: { id: 'x' } });

    // Only the active hook subscribed to task.created should fire.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe('https://example.com/a');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Giper-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(headers['X-Giper-Event']).toBe('task.created');

    const a = await prisma.webhook.findFirstOrThrow({ where: { url: 'https://example.com/a' } });
    expect(a.lastStatus).toBe(200);
    expect(a.lastFiredAt).not.toBeNull();
  });

  it('blocks an internal URL at send time without calling fetch', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    await prisma.webhook.create({
      data: { projectId: project.id, url: 'https://169.254.169.254/x', secret: 's', events: ['task.created'], active: true },
    });

    await dispatchWebhooks(project.id, 'task.created', { task: { id: 'x' } });

    expect(fetchMock).not.toHaveBeenCalled();
    const h = await prisma.webhook.findFirstOrThrow({ where: { projectId: project.id } });
    expect(h.lastError).toBeTruthy();
  });
});
