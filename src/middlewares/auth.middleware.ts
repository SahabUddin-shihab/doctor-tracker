import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../modules/auth/tokens.js';
import { unauthorized } from '../utils/errors.js';

export const ACCESS_COOKIE = 'access_token';

/**
 * Authentication: requires a valid, unexpired access token in the HttpOnly cookie.
 * Expired/invalid/missing tokens all yield 401 (the client then tries /auth/refresh).
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const token: unknown = req.cookies?.[ACCESS_COOKIE];
  if (typeof token !== 'string' || token.length === 0) {
    next(unauthorized('Authentication required'));
    return;
  }
  try {
    const payload = verifyAccessToken(token);
    req.admin = { id: payload.sub, role: payload.role };
    next();
  } catch (error) {
    // The central error handler maps TokenExpiredError / JsonWebTokenError to 401.
    next(error);
  }
}
