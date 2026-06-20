import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { RoleBuilder } from '@/components/domain/roles/RoleBuilder';

export const dynamic = 'force-dynamic';

export default async function NewCustomRolePage() {
  const me = await requireAuth();
  if (me.role !== 'ADMIN') notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/settings/roles" className="text-sm text-muted-foreground hover:underline">← Роли</Link>
        <h1 className="text-xl font-semibold">Новая роль</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Права роли</CardTitle>
        </CardHeader>
        <CardContent>
          <RoleBuilder mode="create" />
        </CardContent>
      </Card>
    </div>
  );
}
