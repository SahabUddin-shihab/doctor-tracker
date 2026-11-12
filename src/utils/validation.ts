import { z } from 'zod';
import { env } from '../config/env.js';
import { parseBoundary } from './time.js';

export const objectId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');

export const idParams = z.object({ id: objectId });

/** Phone numbers: optional leading +, 7–15 digits; spaces, dashes, dots and brackets are stripped. */
export const phoneField = z
  .string()
  .trim()
  .min(1, 'Phone number is required')
  .transform((value) => value.replace(/[\s\-().]/g, ''))
  .pipe(z.string().regex(/^\+?\d{7,15}$/, 'Enter a valid phone number (7–15 digits)'));

export const emailField = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address').max(254));

export const requiredText = (label: string, min = 2, max = 100) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .pipe(z.string().min(min, `${label} must be at least ${min} characters`).max(max, `${label} must be at most ${max} characters`));

/** Query-string text: empty string means "not provided". */
export const optionalQueryText = (max = 100) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

export const paginationQuery = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
};

export const sortOrder = z.enum(['asc', 'desc']).default('desc');

const dateBoundary = (edge: 'start' | 'end') =>
  z
    .string()
    .trim()
    .optional()
    .transform((value, ctx) => {
      if (!value) return undefined;
      const date = parseBoundary(value, edge, env.APP_TIMEZONE);
      if (!date) {
        ctx.addIssue({ code: 'custom', message: 'Use a valid date (YYYY-MM-DD) or ISO timestamp' });
        return z.NEVER;
      }
      return date;
    });

export const createdFrom = dateBoundary('start');
export const createdTo = dateBoundary('end');

export function refineDateRange<T extends { createdFrom?: Date; createdTo?: Date }>(value: T, ctx: z.RefinementCtx) {
  if (value.createdFrom && value.createdTo && value.createdFrom > value.createdTo) {
    ctx.addIssue({ code: 'custom', path: ['createdFrom'], message: '"From" date must not be after "To" date' });
  }
}

/** Mongo filter fragment for the createdAt range, or undefined if neither bound is set. */
export function createdAtRange(from?: Date, to?: Date): Record<string, Date> | undefined {
  if (!from && !to) return undefined;
  return { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
}
