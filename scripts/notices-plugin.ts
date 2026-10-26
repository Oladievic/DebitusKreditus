import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';

export function thirdPartyNotices(): Plugin {
  let root = process.cwd();
  const content = () => readFile(path.join(root, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
  return {
    name: 'debitus-third-party-notices',
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== '/THIRD_PARTY_NOTICES.txt') return next();
        try {
          response.statusCode = 200;
          response.setHeader('Content-Type', 'text/plain; charset=utf-8');
          response.end(await content());
        } catch (error) {
          next(error);
        }
      });
    },
    async generateBundle() {
      if (this.environment.name !== 'client') return;
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD_PARTY_NOTICES.txt',
        source: await content(),
      });
    },
  };
}
