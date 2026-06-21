import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import { relinkBitrixParents } from '@giper/integrations/bitrix24';
import { makeUser, makeProject, makeTask } from './helpers/factories';

/**
 * relinkBitrixParents resolves the local parentId self-relation from the stored
 * bitrixParentId (upstream PARENT_ID) — the deferred pass that runs after the
 * task batch, since a child can sync before its parent exists locally.
 */
describe('relinkBitrixParents', () => {
  it('links a child to its parent by externalId; idempotent', async () => {
    const owner = await makeUser();
    const p = await makeProject({ ownerId: owner.id });

    const parent = await makeTask({ projectId: p.id, creatorId: owner.id });
    await prisma.task.update({
      where: { id: parent.id },
      data: { externalSource: 'bitrix24', externalId: 'P100' },
    });
    const child = await makeTask({ projectId: p.id, creatorId: owner.id });
    await prisma.task.update({
      where: { id: child.id },
      data: { externalSource: 'bitrix24', externalId: 'C200', bitrixParentId: 'P100' },
    });

    const linked = await relinkBitrixParents(prisma);
    expect(linked).toBe(1);
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: child.id } })).parentId,
    ).toBe(parent.id);

    // Second run is a no-op — nothing left to (re)link.
    expect(await relinkBitrixParents(prisma)).toBe(0);
  });

  it('does not link when the parent is missing, and never self-links', async () => {
    const owner = await makeUser();
    const p = await makeProject({ ownerId: owner.id });

    const orphan = await makeTask({ projectId: p.id, creatorId: owner.id });
    await prisma.task.update({
      where: { id: orphan.id },
      data: { externalSource: 'bitrix24', externalId: 'O1', bitrixParentId: 'NOPE' },
    });
    // A task that (wrongly) points at itself must not become its own parent.
    const selfref = await makeTask({ projectId: p.id, creatorId: owner.id });
    await prisma.task.update({
      where: { id: selfref.id },
      data: { externalSource: 'bitrix24', externalId: 'S1', bitrixParentId: 'S1' },
    });

    expect(await relinkBitrixParents(prisma)).toBe(0);
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: orphan.id } })).parentId,
    ).toBeNull();
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: selfref.id } })).parentId,
    ).toBeNull();
  });
});
