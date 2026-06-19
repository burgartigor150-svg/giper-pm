import type { SlaState } from '@/lib/servicedesk/sla';

const LABEL: Record<SlaState, string> = {
  none: '—',
  'on-track': 'в графике',
  'due-soon': 'скоро срок',
  breached: 'просрочен SLA',
  met: 'в срок',
};
const CLASS: Record<SlaState, string> = {
  none: 'bg-muted text-muted-foreground',
  'on-track': 'bg-emerald-100 text-emerald-700',
  'due-soon': 'bg-amber-100 text-amber-700',
  breached: 'bg-rose-100 text-rose-700',
  met: 'bg-sky-100 text-sky-700',
};

export function SlaBadge({ state }: { state: SlaState }) {
  if (state === 'none') return null;
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${CLASS[state]}`}>
      {LABEL[state]}
    </span>
  );
}
