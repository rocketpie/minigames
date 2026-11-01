export const ALLOWED_RETURN_ORIGINS = [
  'https://co3d.eu',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
];

export function safeReturn(value, origin = '') {
  try {
    const url = new URL(String(value ?? ''));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    if (url.username || url.password) return '';
    if (url.href.length > 1024) return '';
    if (origin && url.origin === origin) return url.href;
    return ALLOWED_RETURN_ORIGINS.includes(url.origin) ? url.href : '';
  } catch {
    return '';
  }
}
