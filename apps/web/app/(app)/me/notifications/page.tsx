import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { PushToggle } from '@/components/domain/PushOptIn';
import { NotificationPreferencesForm } from '@/components/domain/NotificationPreferencesForm';
import { getNotificationPreferences } from '@/lib/notifications/getNotificationPreferences';

/**
 * /me/notifications — per-browser Web Push opt-in plus per-kind in-app
 * notification preferences (which categories reach the inbox/bell).
 *
 * Gated by requireAuth so we know which user the subscription and the
 * preferences belong to.
 */
export default async function NotificationsSettingsPage() {
  const me = await requireAuth();
  const prefs = await getNotificationPreferences(me.id);
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Категории уведомлений</CardTitle>
        </CardHeader>
        <CardContent>
          <NotificationPreferencesForm initial={prefs} />
        </CardContent>
      </Card>
    </div>
  );
}
