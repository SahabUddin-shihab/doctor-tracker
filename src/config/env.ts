import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

const duration = z
  .string()
  .regex(/^\d+[smhd]$/, 'Use a number followed by s, m, h or d (e.g. 15m, 7d)');

const secret = z.string().min(32, 'Must be at least 32 characters');

const originList = z
  .string()
  .min(1)
  .transform((value) => value.split(',').map((origin) => origin.trim().replace(/\/$/, '')))
  .pipe(z.array(z.url()).min(1));

const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Must be a valid IANA timezone (e.g. UTC, Asia/Dhaka)');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_ACCESS_SECRET: secret,
  JWT_REFRESH_SECRET: secret,
  COOKIE_SECRET: secret,
  ACCESS_TOKEN_EXPIRES_IN: duration.default('15m'),
  REFRESH_TOKEN_EXPIRES_IN: duration.default('7d'),
  FRONTEND_URL: originList,
  ADMIN_EMAIL: z.email().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  /** Timezone used for "this month" boundaries and trend buckets. */
  APP_TIMEZONE: timezone.default('UTC'),
  /** Number of reverse-proxy hops to trust (for correct client IPs behind a proxy). */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    const secrets = [env.JWT_ACCESS_SECRET, env.JWT_REFRESH_SECRET, env.COOKIE_SECRET];
    if (secrets.some((value) => value.includes('replace-with'))) {
      throw new Error('Invalid environment configuration: placeholder secrets are not allowed in production');
    }
    if (new Set(secrets).size !== secrets.length) {
      throw new Error('Invalid environment configuration: JWT/cookie secrets must all be different');
    }
  }
  return env;
}

export const env: Env = loadEnv();
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
