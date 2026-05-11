import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { PushToggle } from '@/components/domain/PushOptIn';

/**
 * /me/notifications — per-browser opt-in for Web Push.
 *
 * Notification.permission is browser-scoped so this page is the same
 * for every user but the toggle's state varies per device. The page
 * itself is gated by requireAuth so we know which user the new
 * subscription should be associated with.
 */
export default async function NotificationsSettingsPage() {
  await requireAuth();
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 md:px-6">
      <h1 className="text-2xl font-semibold">Уведомления</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Push в браузере</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Получайте уведомления о звонках, упоминаниях и назначении на задачу даже когда вкладка
            giper-pm не активна. Уведомление прилетит в систему — клик откроет нужную страницу.
          </p>
          <PushToggle />
          <p className="text-xs text-muted-foreground">
            Подписка работает только в этом браузере. Чтобы получать уведомления на телефоне, откройте
            giper-pm там и включите тут же ещё раз.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
