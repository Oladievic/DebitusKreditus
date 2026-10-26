import type { MiddlewareHandler } from 'hono';

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

function configuredHostname(value: string): string {
  const authority = value.includes(':') && !value.startsWith('[') ? `[${value}]` : value;
  const parsed = new URL(`http://${authority}`);
  if (
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  )
    throw new Error('HOST должен содержать только имя узла или IP-адрес.');
  return parsed.hostname;
}

export function localHostGuard(options: {
  hostname: string;
  appOrigin?: string;
}): MiddlewareHandler {
  // Origin alone trusts the supplied Host and cannot prevent DNS rebinding.
  const hosts = new Set(LOOPBACK_HOSTS);
  const bindHostname = configuredHostname(options.hostname);
  if (!['0.0.0.0', '[::]'].includes(bindHostname)) hosts.add(bindHostname);
  if (options.appOrigin) {
    const origin = new URL(options.appOrigin);
    if (
      !['http:', 'https:'].includes(origin.protocol) ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash
    )
      throw new Error('APP_ORIGIN должен содержать HTTP(S) origin без пути и авторизации.');
    hosts.add(origin.hostname);
  }
  return async (c, next) => {
    const url = new URL(c.req.url);
    const host = c.req.header('host');
    let trusted = hosts.has(url.hostname);
    if (host) {
      try {
        const authority = new URL(`${url.protocol}//${host}`);
        trusted &&=
          hosts.has(authority.hostname) &&
          !authority.username &&
          !authority.password &&
          authority.pathname === '/' &&
          !authority.search &&
          !authority.hash;
      } catch {
        trusted = false;
      }
    }
    if (!trusted) {
      c.header('Cache-Control', 'no-store');
      c.header('X-Content-Type-Options', 'nosniff');
      return c.json(
        {
          error: {
            code: 'HOST_DENIED',
            message: 'Адрес кабинета не разрешён в настройках локального запуска.',
          },
        },
        403,
      );
    }
    await next();
  };
}
