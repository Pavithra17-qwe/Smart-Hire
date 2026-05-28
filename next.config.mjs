/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pdf-parse'],

  experimental: {
    serverActions: {
      bodySizeLimit: '150mb',
    },
  },
};

export default nextConfig;