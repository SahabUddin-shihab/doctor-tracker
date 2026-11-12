import type { CookieOptions, Response } from 'express';
import { isProduction } from '../../config/env.js';
import { ACCESS_COOKIE } from '../../middlewares/auth.middleware.js';
import { CSRF_COOKIE, createCsrfToken } from '../../middlewares/csrf.middleware.js';
import { accessTtlMs } from './tokens.js';

export const REFRESH_COOKIE = 'refresh_token';
/** The refresh cookie is only ever sent to the auth endpoints. */
const REFRESH_PATH = '/api/v1/auth';

const base: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
};

export function setSessionCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string; refreshTtlMs: number; remember: boolean },
): string {
  const csrfToken = createCsrfToken();
  res.cookie(ACCESS_COOKIE, tokens.accessToken, { ...base, path: '/', maxAge: accessTtlMs });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base,
    path: REFRESH_PATH,
    // Without "remember me" this is a session cookie that disappears when the browser closes.
    ...(tokens.remember ? { maxAge: tokens.refreshTtlMs } : {}),
  });
  res.cookie(CSRF_COOKIE, csrfToken, {
    ...base,
    path: '/',
    ...(tokens.remember ? { maxAge: tokens.refreshTtlMs } : {}),
  });
  return csrfToken;
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base, path: REFRESH_PATH });
  res.clearCookie(CSRF_COOKIE, { ...base, path: '/' });
}
