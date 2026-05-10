'use client';

import { useCallback, useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';

type TgWebApp = {
  ready: () => void;
  expand: () => void;
  initData: string;
  initDataUnsafe?: unknown;
  version?: string;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

export function TelegramWebAppLogin() {
  const [phase, setPhase] = useState<'loading' | 'busy' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);

  const run = useCallback(async () => {
    const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
    if (!tg) {
      setPhase('error');
      setMessage(
        'Откройте эту страницу из Telegram (кнопка меню или Web App). В обычном браузере вход недоступен.',
      );
      return;
    }

    tg.ready();
    tg.expand();

    const initData = tg.initData?.trim() ?? '';
    if (!initData) {
      setPhase('error');
      setMessage('Telegram не передал данные авторизации. Обновите Mini App или откройте ссылку заново.');
      return;
    }

    setPhase('busy');
    setMessage(null);

    const res = await signIn('telegram-webapp', {
      initData,
      redirect: false,
      callbackUrl: '/calendar',
    });

    if (!res?.ok || res.error) {
      setPhase('error');
      setMessage(
        'Не удалось войти. Сначала привяжите Telegram к учётке в вебе: Настройки → Интеграции → Telegram, команда /pair у бота.',
      );
      return;
    }

    window.location.href = res.url ?? '/calendar';
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--tg-theme-bg-color,#f4f4f5)] p-6 text-center text-[var(--tg-theme-text-color,#18181b)]">
      <div className="text-lg font-semibold">giper-pm</div>
      {phase === 'loading' || phase === 'busy' ? (
        <p className="text-sm text-[var(--tg-theme-hint-color,#71717a)]">
          {phase === 'busy' ? 'Входим…' : 'Загрузка…'}
        </p>
      ) : (
        <p className="max-w-md text-sm text-red-700">{message}</p>
      )}
      {phase === 'error' ? (
        <button
          type="button"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white"
          onClick={() => {
            setPhase('loading');
            void run();
          }}
        >
          Повторить
        </button>
      ) : null}
    </div>
  );
}
