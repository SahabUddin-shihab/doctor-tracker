import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { requireRole } from '../../middlewares/authorization.middleware.js';
import { loginLimiter, sessionLimiter } from '../../middlewares/rate-limit.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import * as controller from './auth.controller.js';
import { loginSchema } from './auth.validation.js';

export interface AuthRouterOptions {
  rateLimit: boolean;
}

export function createAuthRouter({ rateLimit }: AuthRouterOptions): Router {
  const router = Router();
  const noop = (_req: unknown, _res: unknown, next: () => void) => next();
  const loginGuard = rateLimit ? loginLimiter : noop;
  const sessionGuard = rateLimit ? sessionLimiter : noop;

  router.post('/login', loginGuard, validate(loginSchema), controller.login);
  router.post('/refresh', sessionGuard, controller.refresh);
  router.post('/logout', sessionGuard, controller.logout);
  router.get('/me', authenticate, requireRole('admin'), controller.me);

  return router;
}
