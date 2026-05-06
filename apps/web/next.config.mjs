import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@giper/db', '@giper/integrations', '@giper/shared', '@giper/ui'],
  experimental: {
    typedRoutes: false,
  },
};

export default withNextIntl(nextConfig);
