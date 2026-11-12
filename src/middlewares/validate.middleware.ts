import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { AppError, badRequest } from '../utils/errors.js';

/**
 * Validates `{ body, query, params }` against a Zod schema and stores the parsed,
 * coerced result on `req.validated`. (Express 5 makes `req.query` read-only, so
 * parsed values are never written back to the request.)
 */
export function validate(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse({ body: req.body, query: req.query, params: req.params });
    if (!result.success) {
      next(
        new AppError(
          400,
          'Validation failed',
          result.error.issues.map((issue) => ({
            path: issue.path.slice(1).join('.') || issue.path.join('.'),
            message: issue.message,
          })),
          'VALIDATION_ERROR',
        ),
      );
      return;
    }
    req.validated = result.data;
    next();
  };
}

/** Typed accessor for the output of validate(). */
export function getInput<T>(req: Request): T {
  return req.validated as T;
}

function containsOperatorKey(value: unknown, depth = 0): boolean {
  if (depth > 10 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => containsOperatorKey(item, depth + 1));
  return Object.entries(value as Record<string, unknown>).some(
    ([key, nested]) => key.startsWith('$') || key.includes('.') || containsOperatorKey(nested, depth + 1),
  );
}

/**
 * Defence-in-depth against NoSQL operator injection ({"email": {"$ne": null}}).
 * Zod schemas already reject non-string values; this guard also rejects any
 * request that smuggles `$operator` or dotted keys before it reaches a handler.
 */
export function rejectOperatorInjection(req: Request, _res: Response, next: NextFunction): void {
  if (containsOperatorKey(req.body) || containsOperatorKey(req.query) || containsOperatorKey(req.params)) {
    next(badRequest('Request contains disallowed characters in field names'));
    return;
  }
  next();
}
