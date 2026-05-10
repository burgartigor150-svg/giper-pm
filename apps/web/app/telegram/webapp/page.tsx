import type { Metadata } from 'next';
import { TelegramWebAppLogin } from './TelegramWebAppLogin';

export const metadata: Metadata = {
  title: 'giper-pm · Telegram',
  description: 'Вход через Telegram Mini App',
};

export default function TelegramWebAppPage() {
  return <TelegramWebAppLogin />;
}
