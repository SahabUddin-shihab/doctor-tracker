import type { NextFunction, Request, Response } from 'express';
import { forbidden, unauthorized } from '../utils/errors.js';

export type Role = 'admin';

/** Authorization: the authenticated principal must hold one of the allowed roles. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.admin) {
      next(unauthorized('Authentication required'));
      return;
    }
    if (!roles.includes(req.admin.role as Role)) {
      next(forbidden());
      return;
    }
    next();
  };
}
