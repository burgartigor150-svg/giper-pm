import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import { getProjectBudgetReport } from '@/lib/reports/projectBudget';
import { makeProject, makeTask, makeUser } from './helpers/factories';

/**
 * Budget report: estimates, spent hours, velocity over a 14-day window,
 * projected finish date, money math, and the over-budget flag.
 *
 * Source: apps/web/lib/reports/projectBudget.ts
 */

async function makeTimeEntry(args: {
  userId: string;
  taskId: string;
  minutes: number;
  endedAt?: Date;
}) {
  const ended = args.endedAt ?? new Date();
  const started = new Date(ended.getTime() - args.minutes * 60_000);
  return prisma.timeEntry.create({
    data: {
      userId: args.userId,
      taskId: args.taskId,
      startedAt: started,
      endedAt: ended,
      durationMin: args.minutes,
      source: 'MANUAL_FORM',
    },
  });
}

describe('getProjectBudgetReport', () => {
  it('returns null for an unknown project', async () => {
    expect(await getProjectBudgetReport('no-such-id')).toBeNull();
  });

  it('zero tasks, zero entries → all zeros, no projection', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const r = await getProjectBudgetReport(project.id);
    expect(r).not.toBeNull();
    expect(r!.estimatedHours).toBe(0);
    expect(r!.spentHours).toBe(0);
    expect(r!.velocityHoursPerDay).toBe(0);
    expect(r!.projectedDaysToFinish).toBeNull();
    expect(r!.projectedFinishDate).toBeNull();
    expect(r!.overBudget).toBe(false);
  });

  it('sums estimateHours across tasks; CANCELED tasks are excluded', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const t1 = await makeTask({ projectId: project.id, creatorId: owner.id });
    const t2 = await makeTask({ projectId: project.id, creatorId: owner.id });
    const t3 = await makeTask({ projectId: project.id, creatorId: owner.id });
    await prisma.task.update({ where: { id: t1.id }, data: { estimateHours: 4 } });
    await prisma.task.update({ where: { id: t2.id }, data: { estimateHours: 6 } });
    await prisma.task.update({
      where: { id: t3.id },
      data: { estimateHours: 999, internalStatus: 'CANCELED' },
    });
    const r = await getProjectBudgetReport(project.id);
    expect(r!.estimatedHours).toBe(10);
  });

  it('spent hours = closed TimeEntry minutes / 60, across every task in the project', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const t1 = await makeTask({ projectId: project.id, creatorId: owner.id });
    const t2 = await makeTask({ projectId: project.id, creatorId: owner.id });
    await makeTimeEntry({ userId: owner.id, taskId: t1.id, minutes: 90 });
    await makeTimeEntry({ userId: owner.id, taskId: t2.id, minutes: 30 });
    const r = await getProjectBudgetReport(project.id);
    expect(r!.spentHours).toBeCloseTo(2, 2);
  });

  it('ignores open (endedAt=null) TimeEntries — only finished work counts', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const t1 = await makeTask({ projectId: project.id, creatorId: owner.id });
    await prisma.timeEntry.create({
      data: {
        userId: owner.id,
        taskId: t1.id,
        startedAt: new Date(Date.now() - 3600_000),
        endedAt: null,
        durationMin: 0,
        source: 'MANUAL_TIMER',
      },
    });
    const r = await getProjectBudgetReport(project.id);
    expect(r!.spentHours).toBe(0);
  });

  it('velocity ignores entries outside the 14-day window', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const t = await makeTask({ projectId: project.id, creatorId: owner.id });
    // 60 minutes of recent work — within window.
    await makeTimeEntry({ userId: owner.id, taskId: t.id, minutes: 60 });
    // 600 minutes from 30 days ago — outside the velocity window.
    await makeTimeEntry({
      userId: owner.id,
      taskId: t.id,
      minutes: 600,
      endedAt: new Date(Date.now() - 30 * 24 * 3600_000),
    });
    const r = await getProjectBudgetReport(project.id);
    // velocity = 1h / 14 days ≈ 0.07
    expect(r!.velocityHoursPerDay).toBeCloseTo(1 / 14, 2);
    // spentHours sees BOTH (no window for total spent).
    expect(r!.spentHours).toBeCloseTo(11, 1);
  });

  it('over-budget flag flips when spent > budgetHours', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    await prisma.project.update({
      where: { id: project.id },
      data: { budgetHours: 1, hourlyRate: 100 },
    });
    const t = await makeTask({ projectId: project.id, creatorId: owner.id });
    await makeTimeEntry({ userId: owner.id, taskId: t.id, minutes: 90 });
    const r = await getProjectBudgetReport(project.id);
    expect(r!.budgetHours).toBe(1);
    expect(r!.overBudget).toBe(true);
    // money math: 1.5h × 100 = 150
    expect(r!.spentMoney).toBeCloseTo(150, 1);
    expect(r!.budgetMoney).toBeCloseTo(100, 1);
  });

  it('money math is null when hourlyRate is null', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const r = await getProjectBudgetReport(project.id);
    expect(r!.spentMoney).toBeNull();
    expect(r!.budgetMoney).toBeNull();
  });

  it('projected finish date is set when there is velocity and remaining work', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const t = await makeTask({ projectId: project.id, creatorId: owner.id });
    await prisma.task.update({ where: { id: t.id }, data: { estimateHours: 100 } });
    // Generate velocity by logging 14h in the last 14 days → 1h/day.
    await makeTimeEntry({ userId: owner.id, taskId: t.id, minutes: 14 * 60 });
    const r = await getProjectBudgetReport(project.id);
    // remaining = max(0, 100 - 14) = 86 h. at 1h/day → 86 days.
    expect(r!.projectedDaysToFinish).toBe(86);
    expect(r!.projectedFinishDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('remainingEstimatedHours is clamped at zero', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id });
    const t = await makeTask({ projectId: project.id, creatorId: owner.id });
    await prisma.task.update({ where: { id: t.id }, data: { estimateHours: 2 } });
    // Spent more than estimated → remaining can't go negative.
    await makeTimeEntry({ userId: owner.id, taskId: t.id, minutes: 600 });
    const r = await getProjectBudgetReport(project.id);
    expect(r!.remainingEstimatedHours).toBe(0);
  });
});
