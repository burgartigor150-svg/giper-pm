import { requireAuth } from '@/lib/auth';
import { KbAskPanel } from '@/components/domain/knowledge/KbAskPanel';

export default async function KnowledgeAskPage() {
  await requireAuth();
  return <KbAskPanel />;
}
