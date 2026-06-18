import { prisma } from '@giper/db';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { getCustomFields } from '@/lib/board/getCustomFields';
import { TaskCustomFieldsEditor } from './TaskCustomFieldsEditor';

/**
 * Self-contained custom-fields block for the task detail sidebar. Loads its own
 * data (the project's field definitions + this task's values) so the host page
 * needs no extra wiring. Renders nothing when the project has no custom fields.
 */
export async function TaskCustomFields({
  taskId,
  canEdit,
}: {
  taskId: string;
  canEdit: boolean;
}) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { projectId: true },
  });
  if (!task) return null;

  const fields = await getCustomFields(task.projectId);
  if (fields.length === 0) return null;

  let values: Record<string, string> = {};
  try {
    const rows = await prisma.customFieldValue.findMany({
      where: { taskId },
      select: { fieldId: true, value: true },
    });
    values = Object.fromEntries(rows.map((r) => [r.fieldId, r.value]));
  } catch {
    values = {};
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Поля</CardTitle>
      </CardHeader>
      <CardContent>
        <TaskCustomFieldsEditor
          taskId={taskId}
          fields={fields}
          values={values}
          canEdit={canEdit}
        />
      </CardContent>
    </Card>
  );
}
