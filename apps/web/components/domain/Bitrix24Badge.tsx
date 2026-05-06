import { ExternalLink } from 'lucide-react';

/**
 * Build the canonical Bitrix24 task URL from BITRIX24_WEBHOOK_URL portal +
 * task id. Webhook URLs look like
 *   https://giper.bitrix24.ru/rest/1282/<token>/
 * → portal is the first segment.
 */
function bitrixTaskUrl(externalId: string): string | null {
  const webhook = process.env.BITRIX24_WEBHOOK_URL;
  if (!webhook) return null;
  try {
    const u = new URL(webhook);
    return `${u.protocol}//${u.host}/company/personal/user/0/tasks/task/view/${externalId}/`;
  } catch {
    return null;
  }
}

function bitrixGroupUrl(externalId: string): string | null {
  const webhook = process.env.BITRIX24_WEBHOOK_URL;
  if (!webhook) return null;
  try {
    const u = new URL(webhook);
    return `${u.protocol}//${u.host}/workgroups/group/${externalId}/`;
  } catch {
    return null;
  }
}

export function Bitrix24TaskBadge({ externalId }: { externalId: string }) {
  const href = bitrixTaskUrl(externalId);
  return (
    <a
      href={href ?? '#'}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs text-blue-700 hover:bg-blue-100"
      title="Задача синхронизирована из Bitrix24 — редактирование только в Bitrix24"
    >
      Bitrix24 #{externalId}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

export function Bitrix24ProjectBadge({ externalId }: { externalId: string }) {
  const href = bitrixGroupUrl(externalId);
  return (
    <a
      href={href ?? '#'}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs text-blue-700 hover:bg-blue-100"
      title="Проект синхронизируется из Bitrix24"
    >
      Bitrix24
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}
