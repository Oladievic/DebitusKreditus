import react from '@vitejs/plugin-react';
import { defineConfig, type PluginOption } from 'vite';
import hosting from './hosting.config.json' with { type: 'json' };
import { sites } from './scripts/sites-vite-plugin.ts';
import { thirdPartyNotices } from './scripts/notices-plugin.ts';
import { execFileSync } from 'node:child_process';

export default defineConfig(async ({ mode }) => {
  execFileSync(process.execPath, ['scripts/prepare-ocr-assets.mjs'], { stdio: 'inherit' });
  const cloud = mode === 'cloud';
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= 'false';
  process.env.WRANGLER_SEND_METRICS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.WRANGLER_REGISTRY_PATH ??= '.wrangler/dev-registry';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';
  const plugins: PluginOption[] = [react(), thirdPartyNotices()];
  if (cloud) {
    const { cloudflare } = await import('@cloudflare/vite-plugin');
    plugins.push(
      sites(),
      ...cloudflare({
        viteEnvironment: { name: 'server' },
        inspectorPort: false,
        config: {
          name: 'debitus-kreditus',
          main: './server/worker.ts',
          compatibility_date: '2026-10-19',
          compatibility_flags: ['nodejs_compat'],
          assets: {
            binding: 'ASSETS',
            not_found_handling: 'none',
            run_worker_first: ['/api/*', '/mcp'],
          },
          d1_databases: hosting.d1
            ? [
                {
                  binding: hosting.d1,
                  database_name: 'debitus-kreditus-demo',
                  database_id: '00000000-0000-4000-8000-000000000000',
                  migrations_dir: 'migrations',
                },
              ]
            : [],
        },
      }),
    );
  }
  return {
    plugins,
    build: { outDir: cloud ? 'dist' : 'dist/client', emptyOutDir: true, target: 'es2022' },
    ...(cloud ? { environments: { server: { build: { outDir: 'dist/server' } } } } : {}),
    server: {
      host: '127.0.0.1',
      port: Number(process.env.WEB_PORT ?? '5173'),
      strictPort: true,
      watch: { ignored: ['**/output/**', '**/.cache/**'] },
      ...(cloud
        ? {}
        : {
            proxy: {
              '/api': `http://127.0.0.1:${process.env.API_PORT ?? '8787'}`,
              '/mcp': `http://127.0.0.1:${process.env.API_PORT ?? '8787'}`,
            },
          }),
    },
  };
});
