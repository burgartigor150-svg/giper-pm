// Re-export from the shared package so the multi-bot runner (apps/tg-bot)
// and the web app use the exact same cipher implementation/key.
export {
  encryptTgBotToken as encryptToken,
  decryptTgBotToken as decryptToken,
  maskTgBotToken as maskToken,
} from '@giper/shared';
