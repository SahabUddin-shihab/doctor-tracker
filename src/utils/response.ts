import type { Response } from 'express';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function buildMeta(page: number, limit: number, total: number): PaginationMeta {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  message = 'Success',
  options: { status?: number; meta?: PaginationMeta } = {},
): void {
  res.status(options.status ?? 200).json({
    success: true,
    message,
    data,
    ...(options.meta ? { meta: options.meta } : {}),
  });
}
