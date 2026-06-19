/**
 * Webhook event catalogue. Single source of truth shared by the dispatcher,
 * the settings form, and input validation. Each maps to an existing in-app
 * event hook point.
 */
export const WEBHOOK_EVENTS = ['task.created', 'card.moved'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  'task.created': 'Создана карточка',
  'card.moved': 'Карточка сменила колонку',
};

export const WEBHOOK_EVENT_SET: ReadonlySet<string> = new Set(WEBHOOK_EVENTS);
