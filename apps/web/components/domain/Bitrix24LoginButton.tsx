'use client';

import { Button } from '@giper/ui/components/Button';
import { signInWithBitrix24 } from '@/actions/auth';

/**
 * Bitrix24-only sign-in (mirrors hr.promo-giper-ai.ru): a single "Войти через
 * Битрикс24" button. Access is gated server-side to existing active giper-pm
 * users (email match), so a Bitrix24 account alone doesn't grant entry.
 */
export function Bitrix24LoginButton({ callbackUrl }: { callbackUrl: string }) {
  return (
    <div className="flex flex-col gap-3">
      <form action={signInWithBitrix24.bind(null, callbackUrl)}>
        <Button type="submit" className="w-full bg-green-600 text-white hover:bg-green-700">
          Войти через Битрикс24
        </Button>
      </form>
      <p className="text-center text-xs text-muted-foreground">
        Если у вас нет доступа — обратитесь к администратору для добавления в giper-pm.
      </p>
    </div>
  );
}
