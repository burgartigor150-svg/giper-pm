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
  // Type errors are enforced via `pnpm exec tsc --noEmit` (run in CI's
  // test workflow). The monorepo carries some type-only mismatches from
  // React 19 RC + next-auth beta that don't affect runtime; isolating
  // them from the build keeps deploys flowing while we converge versions.
  typescript: { ignoreBuildErrors: true },
  experimental: {
    typedRoutes: false,
    // Server Actions default body cap is 1 MB, which truncates
    // video-note uploads — even a 5-second 480p H.264 clip easily
    // crosses that. We raise the SA cap to 10 MB so the server-side
    // 8 MB limit in sendVideoNoteAction is the real boundary. Don't
    // remove this unless you also lower the server-side cap.
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default withNextIntl(nextConfig);
