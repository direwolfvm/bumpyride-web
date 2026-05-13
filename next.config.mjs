/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    // The sync endpoint accepts ride JSON with full accelWindow arrays;
    // a ~1 h ride can be a few MB.
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default nextConfig;
