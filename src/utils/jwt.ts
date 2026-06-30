/**
 * Minimal, dependency-free JWT (HS256) and constant-time secret comparison.
 *
 * The project intentionally avoids pulling in `jsonwebtoken` for the single use
 * case of the admin panel: a stateless HMAC-signed token is ~40 lines with
 * Node's built-in `crypto` (already used elsewhere in `utils/helpers.ts`), needs
 * no extra dependency to install/audit, and is fully under our control.
 *
 * Tokens are standard `header.payload.signature` JWTs with `alg: HS256`, so any
 * normal JWT client/debugger can read them.
 */

import { createHmac, createHash, timingSafeEqual } from 'crypto';

interface JwtHeader {
  alg: 'HS256';
  typ: 'JWT';
}

export interface JwtPayload {
  // Standard claims we set.
  sub?: string;
  iat?: number;
  exp?: number;
  // Plus any custom fields.
  [key: string]: unknown;
}

const HEADER: JwtHeader = { alg: 'HS256', typ: 'JWT' };

const encode = (value: object): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

const sign = (data: string, secret: string): string =>
  createHmac('sha256', secret).update(data).digest('base64url');

/**
 * Sign a payload into a JWT. `iat`/`exp` are filled in automatically from
 * `ttlSec`. Returns the token and its absolute expiry (unix seconds).
 */
export const signJwt = (
  payload: JwtPayload,
  secret: string,
  ttlSec: number,
): { token: string; exp: number } => {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ttlSec;

  const body: JwtPayload = { ...payload, iat, exp };

  const data = `${encode(HEADER)}.${encode(body)}`;
  const signature = sign(data, secret);

  return { token: `${data}.${signature}`, exp };
};

/**
 * Verify a JWT's signature and expiry. Returns the decoded payload on success,
 * or `null` for any malformed / tampered / expired token. Never throws.
 */
export const verifyJwt = (token: string, secret: string): JwtPayload | null => {
  try {
    const parts = token.split('.');

    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;
    const data = `${headerB64}.${payloadB64}`;

    const expected = sign(data, secret);

    // Compare in constant time; bail if lengths differ (timingSafeEqual throws
    // on length mismatch).
    const a = Buffer.from(signatureB64);
    const b = Buffer.from(expected);

    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as JwtPayload;

    if (typeof payload.exp === 'number' && Math.floor(Date.now() / 1000) >= payload.exp) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
};

/**
 * Constant-time equality for shared secrets. Hashes both sides first so the
 * comparison neither leaks length nor throws on differing input lengths.
 */
export const safeEqual = (a: string, b: string): boolean => {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();

  return timingSafeEqual(ha, hb);
};
