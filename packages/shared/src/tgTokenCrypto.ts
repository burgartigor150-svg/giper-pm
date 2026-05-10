/**
 * AES-256-GCM cipher for personal Telegram bot tokens. Each PM provides
 * their own BotFather token via the UI; we never display it back. The
 * tg-bot multi-bot runner is the only consumer that ever decrypts.
 *
 * Storage format: base64(iv | cipher | authTag), 12-byte IV.
 *
 * The master key lives in env `TG_TOKEN_ENC_KEY` and must decode to
 * exactly 32 bytes. Accepted encodings: hex (64 chars), base64 (44
 * chars), or base64url (43 chars).
 *
 * Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALG = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.TG_TOKEN_ENC_KEY?.trim();
  if (!raw) {
    throw new Error(
      'TG_TOKEN_ENC_KEY is not set (32-byte key, hex or base64). ' +
        "Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  let key: Buffer | null = null;
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length === 64) {
    key = Buffer.from(raw, 'hex');
  } else {
    try {
      const norm = raw.replace(/-/g, '+').replace(/_/g, '/');
      const padded = norm + '==='.slice((norm.length + 3) % 4);
      const decoded = Buffer.from(padded, 'base64');
      if (decoded.length === KEY_LEN) key = decoded;
    } catch {
      key = null;
    }
  }
  if (!key || key.length !== KEY_LEN) {
    throw new Error(
      `TG_TOKEN_ENC_KEY must decode to ${KEY_LEN} bytes (got ${key?.length ?? 'invalid'})`,
    );
  }
  cachedKey = key;
  return key;
}

export function encryptToken(plain: string): string {
  if (!plain) throw new Error('encryptToken: empty input');
  const key = loadKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]).toString('base64');
}

export function decryptToken(blob: string): string {
  if (!blob) throw new Error('decryptToken: empty blob');
  const key = loadKey();
  const buf = Buffer.from(blob, 'base64');
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error('decryptToken: ciphertext too short');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const enc = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}

/** Last 4 chars only — for safe display in the UI ("•••••XYZW"). */
export function maskToken(plain: string): string {
  if (!plain) return '';
  const tail = plain.slice(-4);
  return `•••••${tail}`;
}
