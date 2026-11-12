import type { Request, Response } from 'express';
import { isProduction } from '../../config/env.js';
import { CSRF_COOKIE, createCsrfToken, isValidCsrfToken } from '../../middlewares/csrf.middleware.js';
import { getInput } from '../../middlewares/validate.middleware.js';
import { unauthorized } from '../../utils/errors.js';
import { sendSuccess } from '../../utils/response.js';
import { clearSessionCookies, REFRESH_COOKIE, setSessionCookies } from './auth.cookies.js';
import * as authService from './auth.service.js';
import type { LoginInput } from './auth.validation.js';

export async function login(req: Request, res: Response): Promise<void> {
  const { body } = getInput<{ body: LoginInput }>(req);
  const session = await authService.login(body.email, body.password, body.rememberMe, req.get('user-agent'));
  const csrfToken = setSessionCookies(res, session);
  sendSuccess(res, { admin: session.admin, csrfToken }, 'Signed in successfully');
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const token: unknown = req.cookies?.[REFRESH_COOKIE];
  if (typeof token !== 'string' || !token) throw unauthorized('Refresh token missing', 'NO_REFRESH_TOKEN');
  try {
    const session = await authService.refresh(token, req.get('user-agent'));
    const csrfToken = setSessionCookies(res, session);
    sendSuccess(res, { admin: session.admin, csrfToken }, 'Session refreshed');
  } catch (error) {
    clearSessionCookies(res); // a failed rotation must not leave stale cookies behind
    throw error;
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  const token: unknown = req.cookies?.[REFRESH_COOKIE];
  await authService.logout(typeof token === 'string' ? token : undefined);
  clearSessionCookies(res);
  sendSuccess(res, null, 'Signed out successfully');
}

export async function me(req: Request, res: Response): Promise<void> {
  const admin = await authService.getProfile(req.admin!.id);
  // The CSRF token lives in an HttpOnly cookie, so the SPA learns it from this response.
  let csrfToken: unknown = req.cookies?.[CSRF_COOKIE];
  if (!isValidCsrfToken(csrfToken)) {
    csrfToken = createCsrfToken();
    res.cookie(CSRF_COOKIE, csrfToken, { httpOnly: true, sameSite: 'none', secure: isProduction, path: '/' });
  }
  sendSuccess(res, { admin, csrfToken }, 'Profile retrieved successfully');
}
