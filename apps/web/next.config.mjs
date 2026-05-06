/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@giper/db', '@giper/shared', '@giper/ui'],
  experimental: {
    typedRoutes: false,
  },
};

export default nextConfig;
