/**
 * Admin-panel configuration.
 *
 * These secrets are read straight from `process.env` (dotenv is already loaded by
 * `envil` when `configs/envs.ts` is first imported during startup) rather than
 * through `envs()`. That is deliberate: `envil` calls `process.exit(1)` if any
 * listed variable is missing, and the admin panel is a *secondary* subsystem — a
 * missing admin secret must never take down the public donation API. Instead the
 * admin endpoints degrade gracefully to `503` when unconfigured (see
 * `isAdminConfigured`).
 *
 * Required for the admin panel to work:
 *   ADMIN_ID         – first shared secret (an opaque id, sent on login)
 *   ADMIN_SECRET     – second shared secret (sent on login)
 *   ADMIN_JWT_SECRET – HMAC key used to sign/verify the issued JWTs
 * Optional:
 *   ADMIN_TOKEN_TTL_SEC – token lifetime in seconds (default 12h)
 */

const DEFAULT_TTL_SEC = 12 * 60 * 60; // 12 hours

export interface AdminConfig {
  id?: string;
  secret?: string;
  jwtSecret?: string;
  tokenTtlSec: number;
}

export const getAdminConfig = (): AdminConfig => {
  const ttlRaw = Number(process.env.ADMIN_TOKEN_TTL_SEC);

  return {
    id: process.env.ADMIN_ID,
    secret: process.env.ADMIN_SECRET,
    jwtSecret: process.env.ADMIN_JWT_SECRET,
    tokenTtlSec: Number.isFinite(ttlRaw) && ttlRaw > 0 ? ttlRaw : DEFAULT_TTL_SEC,
  };
};

// True only when every secret the login flow needs is present. The login and
// auth handlers short-circuit to 503 when this is false.
export const isAdminConfigured = (): boolean => {
  const { id, secret, jwtSecret } = getAdminConfig();

  return Boolean(id && secret && jwtSecret);
};
