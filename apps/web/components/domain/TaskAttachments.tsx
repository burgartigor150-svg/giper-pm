import { bitrix24DownloadUrl } from '@giper/integrations/bitrix24';
import { getT } from '@/lib/i18n';
import { AttachmentViewer, type AttachmentLite } from './AttachmentViewer';

type Attachment = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Date;
  externalSource: string | null;
  externalId: string | null;
};

export async function TaskAttachments({ attachments }: { attachments: Attachment[] }) {
  const t = await getT('tasks.detail');
  if (attachments.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('noAttachments')}</p>;
  }
  const webhook = process.env.BITRIX24_WEBHOOK_URL;
  const items: AttachmentLite[] = attachments.map((a) => ({
    id: a.id,
    filename: a.filename,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    proxyUrl: `/api/attachments/${a.id}`,
    downloadUrl:
      a.externalSource === 'bitrix24' && a.externalId && webhook
        ? bitrix24DownloadUrl(webhook, a.externalId)
        : null,
  }));
  return <AttachmentViewer attachments={items} />;
}
