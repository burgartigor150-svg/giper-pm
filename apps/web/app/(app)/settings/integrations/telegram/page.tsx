import { redirect } from 'next/navigation';

/** Старый путь → единая страница в сайдбаре «Telegram». */
export default function LegacyTelegramSettingsRedirect() {
  redirect('/integrations/telegram');
}
