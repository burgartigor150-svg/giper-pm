import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { canSeeCrm, canEditCrm } from '@/lib/permissions';
import { listLeads, listPipelines } from '@/lib/crm';
import { NewLeadForm } from '@/components/domain/crm/NewLeadForm';
import { LeadRow } from '@/components/domain/crm/LeadRow';

export const dynamic = 'force-dynamic';

export default async function CrmLeadsPage() {
  const me = await requireAuth();
  if (!canSeeCrm({ id: me.id, role: me.role })) notFound();
  const canEdit = canEditCrm({ id: me.id, role: me.role });
  const [leads, pipelines] = await Promise.all([listLeads(), listPipelines()]);
  const hasPipeline = pipelines.length > 0;
  const active = leads.filter((l) => l.status !== 'CONVERTED').length;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/crm" className="text-sm text-muted-foreground hover:underline">← CRM</Link>
        <h1 className="text-xl font-semibold">Лиды</h1>
        <Link href="/crm/contacts" className="ml-auto text-sm text-muted-foreground hover:underline">
          Контакты →
        </Link>
      </div>

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Новый лид</CardTitle>
          </CardHeader>
          <CardContent>
            <NewLeadForm />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Все лиды ({leads.length}{active !== leads.length ? `, активных ${active}` : ''})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {leads.length === 0 ? (
            <p className="text-sm text-muted-foreground">Лидов пока нет.</p>
          ) : (
            <ul className="divide-y">
              {leads.map((l) => (
                <LeadRow key={l.id} lead={l} canEdit={canEdit} hasPipeline={hasPipeline} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
