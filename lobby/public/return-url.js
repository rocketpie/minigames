export const ALLOWED_RETURN_ORIGINS = [
  'https://co3d.eu',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
];

export function safeReturn(value) {
  try {
    const url = new URL(String(value ?? ''));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    if (url.username || url.password) return '';
    if (url.href.length > 1024) return '';
    return ALLOWED_RETURN_ORIGINS.includes(url.origin) ? url.href : '';
  } catch {
    return '';
  }
}
