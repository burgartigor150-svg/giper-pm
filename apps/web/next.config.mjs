import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@giper/db', '@giper/integrations', '@giper/realtime', '@giper/shared', '@giper/ui'],
  // standalone build → minimal runtime image with .next/standalone +
  // .next/static + public, no node_modules to copy. Critical for the
  // Dockerfile multi-stage to stay under ~200 MB.
  output: 'standalone',
  // Monorepo workspace root for the standalone output tracer. Without
  // this, `next build` warns about multiple lockfiles and may copy
  // wrong dependencies.
  outputFileTracingRoot: new URL('../..', import.meta.url).pathname,
  // ESLint is enforced in CI/dev (`pnpm lint`); the production image
  // installs only runtime deps so the eslint plugin set is incomplete.
  // Skipping during `next build` keeps the prod image small without
  // weakening pre-merge checks.
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    typedRoutes: false,
  },
};

export default withNextIntl(nextConfig);
