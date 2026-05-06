import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import { makeUser } from './helpers/factories';

describe('integration infra smoke', () => {
  it('can write and read a user from the test DB', async () => {
    const u = await makeUser({ email: 'smoke@test.local' });
    const found = await prisma.user.findUnique({ where: { id: u.id } });
    expect(found?.email).toBe('smoke@test.local');
  });

  it('reset between tests cleared previous data', async () => {
    const all = await prisma.user.findMany();
    expect(all).toHaveLength(0);
  });
});
