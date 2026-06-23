'use client';

import { useEffect, useRef } from 'react';
import { recordArticleViewAction } from '@/actions/knowledgeAnalytics';

/** Records one deduped article view on mount. Renders nothing. */
export function KbViewTracker({ articleId }: { articleId: string }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    recordArticleViewAction(articleId).catch(() => {});
  }, [articleId]);
  return null;
}
