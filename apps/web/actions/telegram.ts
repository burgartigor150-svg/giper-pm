'use server';

import { Redis } from 'ioredis';
import { requireAuth } from '@/lib/auth';

/**
 * Mint a 5-minute Telegram pairing code, store it in Redis, and return
 * it to the UI. The bot reads the same Redis key when the user issues
 * `/pair TG-XXXXXX` and sets User.tgChatId.
 *
 * No DB row needed — the code lives only as long as the user is staring
 * at the page. Lost codes self-expire.
 */

let _redis: Redis | null = null;
function redis(): Redis {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');
  _redis = new Redis(url);
  return _redis;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const TTL_SECONDS = 5 * 60;

function newCode(len = 6): string {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return s;
}

export async function generateTgPairingCodeAction(): Promise<{
  code: string;
  expiresAt: number;
  botUsername: string | null;
}> {
  const me = await requireAuth();
  // Try a few times in the unlikely case of a collision (5-min TTL,
  // so collision space is ~very small — but we still loop to be safe).
  let code = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    const c = newCode();
    const ok = await redis().set(`tg:pair:${c}`, me.id, 'EX', TTL_SECONDS, 'NX');
    if (ok === 'OK') {
      code = c;
      break;
    }
  }
  if (!code) throw new Error('Не удалось сгенерировать уникальный код, попробуй ещё раз');
  return {
    code: `TG-${code}`,
    expiresAt: Date.now() + TTL_SECONDS * 1000,
    botUsername: process.env.PUBLIC_TG_BOT_USERNAME ?? null,
  };
}
