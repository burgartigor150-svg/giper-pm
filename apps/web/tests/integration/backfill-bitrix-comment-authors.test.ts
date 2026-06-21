import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import { makeUser, makeProject, makeTask } from './helpers/factories';

/**
 * Verifies the one-time backfill logic (migration 20260621200000): mirrored
 * comments whose author has NO bitrixUserId (could only be the old pull-sync
 * fallback) are reattributed to the inert Bitrix24 bot; genuine local comments
 * and comments by Bitrix-linked users are left untouched. Mirrors the
 * migration's two SQL statements.
 */

const BOT_EMAIL = 'bitrix24-bot@giper.local';

async function runBackfill() {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "User" ("id","email","name","role","isActive","createdAt","updatedAt")
     VALUES ('usr_bitrix24_bot', $1, 'Bitrix24', 'VIEWER'::"UserRole", false, NOW(), NOW())
     ON CONFLICT ("email") DO NOTHING`,
    BOT_EMAIL,
  );
  await prisma.$executeRawUnsafe(
    `UPDATE "Comment"
     SET "authorId" = (SELECT "id" FROM "User" WHERE "email" = $1)
     WHERE "externalSource" = 'bitrix24'
       AND "authorId" IN (SELECT "id" FROM "User" WHERE "bitrixUserId" IS NULL AND "email" <> $1)`,
    BOT_EMAIL,
  );
}

describe('backfill: bitrix comment author reattribution', () => {
  it('reattributes fallback (unlinked-author) mirrored comments to the bot; leaves the rest', async () => {
    const adminUnlinked = await makeUser({ role: 'ADMIN' }); // bitrixUserId null
    const linked = await makeUser({ role: 'MEMBER' });
    await prisma.user.update({ where: { id: linked.id }, data: { bitrixUserId: 'bx-1' } });
    const p = await makeProject({ ownerId: adminUnlinked.id, key: 'BKF' });
    const task = await makeTask({ projectId: p.id, creatorId: adminUnlinked.id });

    const base = { taskId: task.id, source: 'WEB' as const, visibility: 'EXTERNAL' as const };
    // A: mirrored, authored by the unlinked admin = the old fallback → should move to bot.
    const a = await prisma.comment.create({ data: { ...base, authorId: adminUnlinked.id, body: 'Робот сменил статус', externalSource: 'bitrix24', externalId: 'c-robot' } });
    // B: mirrored, authored by a LINKED user (a genuine match) → untouched.
    const b = await prisma.comment.create({ data: { ...base, authorId: linked.id, body: 'реальный коммент', externalSource: 'bitrix24', externalId: 'c-real' } });
    // C: LOCAL comment (no externalSource) by the unlinked admin → untouched.
    const c = await prisma.comment.create({ data: { ...base, authorId: adminUnlinked.id, body: 'локальный коммент' } });

    await runBackfill();

    const botId = (await prisma.user.findUniqueOrThrow({ where: { email: BOT_EMAIL } })).id;
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: a.id } })).authorId).toBe(botId);
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: b.id } })).authorId).toBe(linked.id);
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: c.id } })).authorId).toBe(adminUnlinked.id);

    const bot = await prisma.user.findUniqueOrThrow({ where: { email: BOT_EMAIL } });
    expect(bot.isActive).toBe(false);
    expect(bot.role).toBe('VIEWER');
  });

  it('is idempotent (re-running changes nothing)', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: admin.id, key: 'BKF2' });
    const task = await makeTask({ projectId: p.id, creatorId: admin.id });
    const a = await prisma.comment.create({
      data: { taskId: task.id, authorId: admin.id, body: 'x', source: 'WEB', visibility: 'EXTERNAL', externalSource: 'bitrix24', externalId: 'c1' },
    });
    await runBackfill();
    const botId = (await prisma.user.findUniqueOrThrow({ where: { email: BOT_EMAIL } })).id;
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: a.id } })).authorId).toBe(botId);
    await runBackfill(); // second pass
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: a.id } })).authorId).toBe(botId);
  });
});
