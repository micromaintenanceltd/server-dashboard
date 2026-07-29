/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: the dashboard is a pure client-side app that talks to the
  // Worker API, so it deploys to Cloudflare Pages as static assets. No SSR.
  output: 'export',
  images: { unoptimized: true },
  // Emit each route as a folder with index.html so Pages serves them directly.
  trailingSlash: true,
};

export default nextConfig;
