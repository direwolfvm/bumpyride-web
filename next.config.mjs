import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // @napi-rs/canvas ships native .node bindings; webpack can't bundle them.
  // Mark as external so Next leaves the require() in place at runtime.
  serverExternalPackages: ['@napi-rs/canvas'],
  // Pin the tracing root so worktree / parent checkouts with duplicate
  // lockfiles don't confuse the standalone-output tracer.
  outputFileTracingRoot: __dirname,
  experimental: {
    // The sync endpoint accepts ride JSON with full accelWindow arrays;
    // a ~1 h ride can be a few MB.
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default nextConfig;
