import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { isProduction } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError, type FieldError } from '../utils/errors.js';

interface MongoDuplicateError {
  code: number;
  keyPattern?: Record<string, unknown>;
}

const isDuplicateKey = (error: unknown): error is MongoDuplicateError =>
  typeof error === 'object' && error !== null && (error as MongoDuplicateError).code === 11000;

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, `Route not found: ${req.method} ${req.path}`, [], 'ROUTE_NOT_FOUND'));
}

/** Centralised error handler: every failure leaves the API in the same JSON shape. */
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  let status = 500;
  let message = 'Internal server error';
  let errors: FieldError[] = [];
  let code = 'INTERNAL_ERROR';

  if (error instanceof AppError) {
    status = error.statusCode;
    message = error.message;
    errors = error.errors;
    code = error.code ?? 'ERROR';
  } else if (error instanceof ZodError) {
    status = 400;
    message = 'Validation failed';
    code = 'VALIDATION_ERROR';
    errors = error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
  } else if (error instanceof mongoose.Error.ValidationError) {
    status = 400;
    message = 'Validation failed';
    code = 'VALIDATION_ERROR';
    errors = Object.values(error.errors).map((e) => ({ path: e.path, message: e.message }));
  } else if (error instanceof mongoose.Error.CastError) {
    status = 400;
    message = `Invalid value for ${error.path}`;
    code = 'INVALID_VALUE';
  } else if (isDuplicateKey(error)) {
    const field = Object.keys(error.keyPattern ?? {})[0] ?? 'value';
    status = 409;
    message = `A record with this ${field} already exists`;
    code = 'DUPLICATE';
    errors = [{ path: field, message: `This ${field} is already in use` }];
  } else if (error instanceof jwt.TokenExpiredError) {
    status = 401;
    message = 'Your session has expired';
    code = 'TOKEN_EXPIRED';
  } else if (error instanceof jwt.JsonWebTokenError) {
    status = 401;
    message = 'Invalid authentication token';
    code = 'TOKEN_INVALID';
  } else if (typeof error === 'object' && error !== null && 'type' in error) {
    const type = (error as { type: string }).type;
    if (type === 'entity.parse.failed') {
      status = 400;
      message = 'Malformed JSON body';
      code = 'MALFORMED_JSON';
    } else if (type === 'entity.too.large') {
      status = 413;
      message = 'Request body too large';
      code = 'PAYLOAD_TOO_LARGE';
    }
  }

  if (status >= 500) {
    logger.error({ err: error, method: req.method, url: req.originalUrl }, 'Unhandled error');
  }

  res.status(status).json({
    success: false,
    message: status >= 500 && isProduction ? 'Internal server error' : message,
    errors,
    code,
    ...(status >= 500 && !isProduction && error instanceof Error ? { stack: error.stack } : {}),
  });
}
