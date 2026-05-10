import { createHmac, timingSafeEqual } from 'node:crypto';

/** Telegram may omit `user` for restricted sessions; we still require it for giper-pm login. */
export type VerifiedWebAppUser = {
  telegramUserId: number;
  username?: string;
};

const MAX_AUTH_AGE_SEC = 24 * 60 * 60;

/**
 * Validates `Telegram.WebApp.initData` per
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyTelegramWebAppInitData(
  initData: string,
  botToken: string,
): VerifiedWebAppUser | null {
  if (!initData?.trim() || !botToken) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }

  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return null;

  const authDateRaw = params.get('auth_date');
  const authDate = authDateRaw ? Number.parseInt(authDateRaw, 10) : NaN;
  if (!Number.isFinite(authDate)) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - authDate) > MAX_AUTH_AGE_SEC) return null;

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = createHmac('sha256', Buffer.from('WebAppData', 'utf8'))
    .update(botToken, 'utf8')
    .digest();

  const calculatedHex = createHmac('sha256', secretKey).update(dataCheckString, 'utf8').digest('hex');

  try {
    const a = Buffer.from(calculatedHex, 'hex');
    const b = Buffer.from(hash.toLowerCase(), 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  const userJson = params.get('user');
  if (!userJson) return null;

  try {
    const user = JSON.parse(userJson) as { id?: unknown };
    const id = user?.id;
    if (typeof id !== 'number' || !Number.isFinite(id)) return null;
    const username =
      typeof (user as { username?: unknown }).username === 'string'
        ? (user as { username: string }).username
        : undefined;
    return { telegramUserId: id, username };
  } catch {
    return null;
  }
}
