import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { getTimeEntry } from '@/lib/time';
import { DomainError } from '@/lib/errors';
import { getT } from '@/lib/i18n';
import { EditTimeEntryForm } from '@/components/domain/EditTimeEntryForm';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export default async function EditTimeEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await requireAuth();
  const t = await getT('time.form');

  let entry;
  try {
    entry = await getTimeEntry(id, { id: me.id, role: me.role });
  } catch (e) {
    if (e instanceof DomainError && (e.code === 'NOT_FOUND' || e.code === 'INSUFFICIENT_PERMISSIONS')) {
      notFound();
    }
    throw e;
  }
  if (!entry.endedAt) notFound(); // active timers can't be edited

  const start = new Date(entry.startedAt);
  const end = new Date(entry.endedAt);
  const date = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  const startTime = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
  const endTime = `${pad(end.getHours())}:${pad(end.getMinutes())}`;

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>{t('editTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <EditTimeEntryForm
            entryId={entry.id}
            initial={{
              date,
              startTime,
              endTime,
              note: entry.note ?? '',
              task: entry.task
                ? {
                    id: entry.task.id,
                    number: entry.task.number,
                    title: entry.task.title,
                    projectKey: entry.task.project.key,
                  }
                : null,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
