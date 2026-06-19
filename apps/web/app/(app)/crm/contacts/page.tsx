import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { canSeeCrm, canEditCrm } from '@/lib/permissions';
import { listContacts } from '@/lib/crm';
import { NewContactForm } from '@/components/domain/crm/NewContactForm';
import { ContactRow } from '@/components/domain/crm/ContactRow';

export const dynamic = 'force-dynamic';

export default async function CrmContactsPage() {
  const me = await requireAuth();
  if (!canSeeCrm({ id: me.id, role: me.role })) notFound();
  const canEdit = canEditCrm({ id: me.id, role: me.role });
  const contacts = await listContacts();

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/crm" className="text-sm text-muted-foreground hover:underline">← CRM</Link>
        <h1 className="text-xl font-semibold">Контакты</h1>
      </div>

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Новый контакт</CardTitle>
          </CardHeader>
          <CardContent>
            <NewContactForm />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Все контакты ({contacts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Контактов пока нет.</p>
          ) : (
            <ul className="divide-y">
              {contacts.map((c) => (
                <ContactRow key={c.id} contact={c} canEdit={canEdit} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
