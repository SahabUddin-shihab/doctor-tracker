import { z } from 'zod';
import { createdFrom, createdTo, refineDateRange } from '../../utils/validation.js';

export const TREND_PERIODS = ['daily', 'weekly', 'monthly'] as const;

const limit = (def: number, max: number) => z.coerce.number().int().min(1).max(max).default(def);

export const patientsPerDoctorSchema = z.object({ query: z.object({ limit: limit(10, 50) }) });
export const conditionsSchema = z.object({ query: z.object({ limit: limit(8, 20) }) });
export const recentActivitySchema = z.object({ query: z.object({ limit: limit(10, 50) }) });

export const trendsSchema = z.object({
  query: z
    .object({
      period: z.enum(TREND_PERIODS).default('daily'),
      from: createdFrom,
      to: createdTo,
    })
    .transform(({ from, to, ...rest }) => ({ ...rest, createdFrom: from, createdTo: to }))
    .superRefine(refineDateRange),
});

export type TrendPeriod = (typeof TREND_PERIODS)[number];
export type TrendsQuery = z.infer<typeof trendsSchema>['query'];
