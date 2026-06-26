export const COOKIE_NAME = 'habitat_session';

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

// Una request está autenticada si: cookie de sesión válida, o Bearer == token, o ?token= == token.
// Si no hay token configurado y no hay sesión, es libre (comportamiento histórico del panel).
export function isAuthenticated(req, { sessionStore, token } = {}) {
  const cookies = parseCookies(req.headers && req.headers.cookie);
  const sid = cookies[COOKIE_NAME];
  if (sid && sessionStore && sessionStore.validate(sid)) return true;
  if (!token) return true;
  const hdr = (req.headers && req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (hdr === token) return true;
  const q = new URL(req.url, 'http://x').searchParams.get('token');
  if (q === token) return true;
  return false;
}
