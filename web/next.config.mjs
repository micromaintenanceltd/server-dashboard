import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Stamp public/version.txt with the deploy commit on every build (robust to how
// the CI runs the build). The client polls it and reloads when it differs from
// the version baked into the bundle. 'dev' locally — the watcher ignores 'dev'.
const APP_VERSION = process.env.CF_PAGES_COMMIT_SHA || 'dev';
try {
  const here = dirname(fileURLToPath(import.meta.url));
  mkdirSync(join(here, 'public'), { recursive: true });
  writeFileSync(join(here, 'public', 'version.txt'), APP_VERSION);
} catch {
  /* non-fatal: falls back to manual refresh */
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: the dashboard is a pure client-side app that talks to the
  // Worker API, so it deploys to Cloudflare Pages as static assets. No SSR.
  output: 'export',
  images: { unoptimized: true },
  // Emit each route as a folder with index.html so Pages serves them directly.
  trailingSlash: true,
  // Stamp the build with the deploy commit so the client can detect when a new
  // version has been deployed and reload itself (see VersionWatcher). Cloudflare
  // Pages provides CF_PAGES_COMMIT_SHA at build time; 'dev' locally.
  env: {
    NEXT_PUBLIC_APP_VERSION: APP_VERSION,
  },
};

export default nextConfig;
