// Re-export from the shared subpath. Lives outside the @giper/shared
// barrel so that node:crypto only loads in server-side bundles (server
// actions, API routes), never in client components.
export {
  encryptToken,
  decryptToken,
  maskToken,
} from '@giper/shared/tgTokenCrypto';
