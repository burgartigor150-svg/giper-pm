import Link from 'next/link';

/**
 * Bitrix24-only sign-in (mirrors hr.promo-giper-ai.ru): a single "Войти через
 * Битрикс24" link that kicks off the server-driven OAuth flow at
 * /api/auth/b24/login. Access is gated server-side to existing active giper-pm
 * users (email match), so a Bitrix24 account alone doesn't grant entry.
 */
export function Bitrix24LoginButton({ callbackUrl }: { callbackUrl: string }) {
  const href = `/api/auth/b24/login?callbackUrl=${encodeURIComponent(callbackUrl)}`;
  return (
    <div className="flex flex-col gap-3">
      <Link
        href={href}
        className="inline-flex h-10 w-full items-center justify-center rounded-md bg-green-600 px-4 text-sm font-medium text-white transition-colors hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Войти через Битрикс24
      </Link>
      <p className="text-center text-xs text-muted-foreground">
        Если у вас нет доступа — обратитесь к администратору для добавления в giper-pm.
      </p>
    </div>
  );
}
