'use client';

import { useState } from 'react';
import { Button } from '@giper/ui/components/Button';
import { useT } from '@/lib/useT';

type Props = {
  tempPassword: string;
  onClose: () => void;
};

export function TempPasswordModal({ tempPassword, onClose }: Props) {
  const t = useT('users.tempPassword');
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore — admin can copy manually from the visible field */
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg">
        <h2 className="text-lg font-semibold">{t('title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        <div className="mt-4 flex items-center gap-2">
          <code className="flex-1 select-all rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm">
            {tempPassword}
          </code>
          <Button onClick={copy} variant="outline" size="sm" type="button">
            {copied ? t('copied') : t('copy')}
          </Button>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={onClose} type="button">
            {t('close')}
          </Button>
        </div>
      </div>
    </div>
  );
}
