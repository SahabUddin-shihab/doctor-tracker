export interface FieldError {
  path: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly errors: FieldError[] = [],
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message = 'Bad request', errors: FieldError[] = []) =>
  new AppError(400, message, errors, 'BAD_REQUEST');
export const unauthorized = (message = 'Authentication required', code = 'UNAUTHORIZED') =>
  new AppError(401, message, [], code);
export const forbidden = (message = 'You do not have permission to perform this action') =>
  new AppError(403, message, [], 'FORBIDDEN');
export const notFound = (message = 'Resource not found') => new AppError(404, message, [], 'NOT_FOUND');
export const conflict = (message: string, errors: FieldError[] = []) =>
  new AppError(409, message, errors, 'CONFLICT');
export const unprocessable = (message: string, errors: FieldError[] = []) =>
  new AppError(422, message, errors, 'UNPROCESSABLE');
