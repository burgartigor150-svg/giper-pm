'use client';

import { useTranslations } from 'next-intl';

/**
 * Client-side translation hook. Use in Client Components only.
 *
 *   const t = useT('nav');
 *   t('dashboard');
 */
export const useT = useTranslations;
