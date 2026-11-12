import { rateLimit } from 'express-rate-limit';

const limitMessage = (message: string) => ({
  success: false,
  message,
  errors: [],
  code: 'RATE_LIMITED',
});

/** Broad protection for the whole API. */
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limitMessage('Too many requests, please slow down.'),
});

/** Brute-force protection for credential checks. Successful logins are not counted. */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limitMessage('Too many login attempts. Try again in 15 minutes.'),
});

/** Refresh/logout are cheap but token-bearing; keep them bounded as well. */
export const sessionLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limitMessage('Too many session requests. Try again later.'),
});
