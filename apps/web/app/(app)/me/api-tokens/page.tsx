import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { getApiTokens } from '@/lib/api/getApiTokens';
import { ApiTokensForm } from '@/components/domain/ApiTokensForm';

/** /me/api-tokens — personal API tokens for the public REST API. */
export default async function ApiTokensPage() {
  const me = await requireAuth();
  const tokens = await getApiTokens(me.id);

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 md:px-6">
      <h1 className="text-2xl font-semibold">API-токены</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Личные токены</CardTitle>
        </CardHeader>
        <CardContent>
          <ApiTokensForm initial={tokens} />
        </CardContent>
      </Card>
    </div>
  );
}
