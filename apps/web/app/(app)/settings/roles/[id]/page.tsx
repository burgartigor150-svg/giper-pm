import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { getCustomRole } from '@/lib/customRoles';
import { RoleBuilder } from '@/components/domain/roles/RoleBuilder';

export const dynamic = 'force-dynamic';

export default async function EditCustomRolePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireAuth();
  if (me.role !== 'ADMIN') notFound();

  const { id } = await params;
  const role = await getCustomRole(id);
  if (!role) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/settings/roles" className="text-sm text-muted-foreground hover:underline">← Роли</Link>
        <h1 className="text-xl font-semibold">{role.name}</h1>
        <span className="text-xs text-muted-foreground">{role.assignedCount} польз.</span>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Права роли</CardTitle>
        </CardHeader>
        <CardContent>
          <RoleBuilder
            mode="edit"
            initial={{
              id: role.id,
              name: role.name,
              description: role.description,
              baseRole: role.baseRole,
              capabilities: role.capabilities,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
