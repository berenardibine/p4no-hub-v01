// Single source of truth for the public site URL.
// Change VITE_SITE_URL (env) to move the whole app to a new domain.
export const SITE_URL: string = (
  (import.meta.env.VITE_SITE_URL as string | undefined) || 'https://p4nohub.online'
).replace(/\/+$/, '');

/** Build an absolute public URL from a path (or return an absolute URL unchanged). */
export const absoluteUrl = (path = '/'): string =>
  /^https?:\/\//.test(path) ? path : `${SITE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
