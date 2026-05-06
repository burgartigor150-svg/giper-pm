'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { useT } from '@/lib/useT';
import { ManualTimeForm } from './ManualTimeForm';

export function AddManualToggle() {
  const t = useT('time');
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        {t('addManual')}
      </Button>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('addManual')}</CardTitle>
      </CardHeader>
      <CardContent>
        <ManualTimeForm onCancel={() => setOpen(false)} />
      </CardContent>
    </Card>
  );
}
