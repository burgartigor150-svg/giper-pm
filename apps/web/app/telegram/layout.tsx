import { AuthSessionProvider } from '@/components/providers/AuthSessionProvider';

export default function TelegramLayout({ children }: { children: React.ReactNode }) {
  return <AuthSessionProvider>{children}</AuthSessionProvider>;
}
