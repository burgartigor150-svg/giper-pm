import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { canSeeCrm, canEditCrm, canDeleteCrmPipeline } from '@/lib/permissions';
import { listPipelines, listDealsForPipeline, getPipelineSummary, listContacts } from '@/lib/crm';
import { DealPipeline } from '@/components/domain/crm/DealPipeline';
import { NewDealForm } from '@/components/domain/crm/NewDealForm';
import { PipelineSummary } from '@/components/domain/crm/PipelineSummary';
import { CreateDefaultPipelineButton } from '@/components/domain/crm/CreateDefaultPipelineButton';
import { ArchivePipelineButton } from '@/components/domain/crm/ArchivePipelineButton';

export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function CrmPage({ searchParams }: { searchParams: SP }) {
  const me = await requireAuth();
  if (!canSeeCrm({ id: me.id, role: me.role })) notFound();

  const canEdit = canEditCrm({ id: me.id, role: me.role });
  const canArchivePipeline = canDeleteCrmPipeline({ id: me.id, role: me.role });
  const pipelines = await listPipelines();

  if (pipelines.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-xl font-semibold">CRM — воронки продаж</h1>
        <Card>
          <CardContent className="flex flex-col items-start gap-3 py-6">
            <p className="text-sm text-muted-foreground">
              Воронок ещё нет. Создайте стандартную воронку (Новые → Квалификация →
              Предложение → Выиграно → Проиграно) и начните добавлять сделки.
            </p>
            {canEdit ? <CreateDefaultPipelineButton /> : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  const sp = await searchParams;
  const wanted = typeof sp.pipeline === 'string' ? sp.pipeline : undefined;
  const pipeline = pipelines.find((p) => p.id === wanted) ?? pipelines[0]!;

  const [deals, summary, contacts] = await Promise.all([
    listDealsForPipeline(pipeline.id),
    getPipelineSummary(pipeline.id),
    listContacts(),
  ]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">CRM</h1>
        <div className="flex items-center gap-2">
          {pipelines.map((p) => (
            <Link
              key={p.id}
              href={`/crm?pipeline=${p.id}`}
              className={`rounded-md px-2 py-1 text-sm ${
                p.id === pipeline.id ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60'
              }`}
            >
              {p.name}
            </Link>
          ))}
          <Link href="/crm/contacts" className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted/60">
            Контакты
          </Link>
          {canArchivePipeline ? (
            <ArchivePipelineButton
              pipelineId={pipeline.id}
              pipelineName={pipeline.name}
            />
          ) : null}
        </div>
      </div>

      <PipelineSummary summary={summary} />

      {canEdit ? (
        <Card className="p-3">
          <NewDealForm
            pipelineId={pipeline.id}
            stages={pipeline.stages.map((s) => ({ id: s.id, name: s.name }))}
            contacts={contacts.map((c) => ({ id: c.id, name: c.name }))}
          />
        </Card>
      ) : null}

      <DealPipeline pipeline={pipeline} deals={deals} canEdit={canEdit} />
    </div>
  );
}
