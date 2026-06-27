import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const N = 16384;      // costo CPU/memoria de scrypt
const KEYLEN = 32;
const SALT_BYTES = 16;

// Formato serializado: scrypt$<N>$<saltBase64url>$<hashBase64url>
export function hashPassword(plain) {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(String(plain), salt, KEYLEN, { N });
  return `scrypt$${N}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(plain, stored) {
  try {
    const [scheme, nStr, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64url');
    const expected = Buffer.from(hashB64, 'base64url');
    if (salt.length === 0 || expected.length === 0) return false;
    const actual = scryptSync(String(plain), salt, expected.length, { N: Number(nStr) });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
