import { prisma, TaskStatus, TaskPriority, TaskType, MemberRole, UserRole } from '../src';

async function main() {
  const admin = await prisma.user.upsert({
    where: { email: 'igor@giper.fm' },
    update: {},
    create: {
      email: 'igor@giper.fm',
      name: 'Игорь',
      role: UserRole.ADMIN,
      timezone: 'Europe/Moscow',
      locale: 'ru',
    },
  });

  const project = await prisma.project.upsert({
    where: { key: 'GFM' },
    update: {},
    create: {
      key: 'GFM',
      name: 'giper.fm',
      description: 'Демо-проект для разработки giper-pm',
      ownerId: admin.id,
      members: {
        create: {
          userId: admin.id,
          role: MemberRole.LEAD,
        },
      },
    },
  });

  const tasksSpec = [
    {
      number: 1,
      title: 'Настроить CI и линтеры',
      status: TaskStatus.BACKLOG,
      priority: TaskPriority.LOW,
      type: TaskType.CHORE,
    },
    {
      number: 2,
      title: 'Спроектировать канбан-доску',
      status: TaskStatus.TODO,
      priority: TaskPriority.MEDIUM,
      type: TaskType.FEATURE,
    },
    {
      number: 3,
      title: 'Реализовать Live Timer',
      status: TaskStatus.IN_PROGRESS,
      priority: TaskPriority.HIGH,
      type: TaskType.FEATURE,
    },
    {
      number: 4,
      title: 'Починить расчёт duration в TimeEntry',
      status: TaskStatus.REVIEW,
      priority: TaskPriority.HIGH,
      type: TaskType.BUG,
    },
    {
      number: 5,
      title: 'Скаффолд монорепо',
      status: TaskStatus.DONE,
      priority: TaskPriority.MEDIUM,
      type: TaskType.CHORE,
    },
  ] as const;

  const now = new Date();

  for (const t of tasksSpec) {
    await prisma.task.upsert({
      where: { projectId_number: { projectId: project.id, number: t.number } },
      update: {},
      create: {
        projectId: project.id,
        number: t.number,
        title: t.title,
        status: t.status,
        priority: t.priority,
        type: t.type,
        creatorId: admin.id,
        assigneeId: admin.id,
        startedAt: t.status === TaskStatus.IN_PROGRESS || t.status === TaskStatus.REVIEW || t.status === TaskStatus.DONE ? now : null,
        completedAt: t.status === TaskStatus.DONE ? now : null,
      },
    });
  }

  const counts = {
    users: await prisma.user.count(),
    projects: await prisma.project.count(),
    tasks: await prisma.task.count(),
  };
  console.log('seed: done', counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
