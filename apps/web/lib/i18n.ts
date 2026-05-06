import { getTranslations } from 'next-intl/server';

/**
 * Server-side translation helper. Use in Server Components and Server Actions.
 *
 *   const t = await getT('nav');
 *   t('dashboard');
 */
export const getT = getTranslations;
