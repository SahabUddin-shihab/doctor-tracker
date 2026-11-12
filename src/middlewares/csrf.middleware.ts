import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { forbidden } from '../utils/errors.js';

export const CSRF_COOKIE = 'csrf_token';
export const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function sign(nonce: string): string {
  return crypto.createHmac('sha256', env.COOKIE_SECRET).update(nonce).digest('base64url');
}

/** Signed double-submit token: `<nonce>.<hmac(nonce)>`. */
export function createCsrfToken(): string {
  const nonce = crypto.randomBytes(24).toString('base64url');
  return `${nonce}.${sign(nonce)}`;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function isValidCsrfToken(token: unknown): token is string {
  if (typeof token !== 'string') return false;
  const [nonce, signature] = token.split('.');
  return Boolean(nonce && signature && safeEqual(signature, sign(nonce)));
}

export interface CsrfOptions {
  /** Paths with no session yet, so there is nothing to forge (login). */
  exempt?: string[];
  /**
   * Paths that must work when the in-memory token has been lost (a page reload while the short-lived access
   * token has expired: the SPA can only recover through /auth/refresh). They are still protected by a strict
   * Origin check, the path-scoped SameSite refresh cookie (never sent on cross-site POSTs) and CORS.
   */
  originOnly?: string[];
}

/**
 * CSRF protection for cookie-authenticated, state-changing requests.
 *
 *  1. If an Origin header is present it must be one of the trusted frontend origins.
 *  2. The `x-csrf-token` header must equal the HttpOnly `csrf_token` cookie, and carry
 *     a valid HMAC. A cross-site attacker can neither read the token (CORS blocks the
 *     response that reveals it) nor set the header on a cross-origin request.
 */
export function csrfProtection({ exempt = [], originOnly = [] }: CsrfOptions = {}) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(req.method) || exempt.includes(req.path)) {
      next();
      return;
    }

    const origin = req.get('origin');
    if (origin && !env.FRONTEND_URL.includes(origin)) {
      next(forbidden('Request origin is not allowed'));
      return;
    }
    if (originOnly.includes(req.path)) {
      next();
      return;
    }

    const cookieToken: unknown = req.cookies?.[CSRF_COOKIE];
    const headerToken = req.get(CSRF_HEADER);
    if (
      !isValidCsrfToken(cookieToken) ||
      typeof headerToken !== 'string' ||
      !safeEqual(cookieToken, headerToken)
    ) {
      next(forbidden('Invalid or missing CSRF token'));
      return;
    }
    next();
  };
}
