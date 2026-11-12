import { z } from 'zod';
import { Admin } from './admin.model.js';
import { hashPassword } from './auth.service.js';

/** Strong-password policy for administrator accounts created by the seed. */
export const adminSeedSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .max(128)
    .regex(/[a-z]/, 'Password must contain a lowercase letter')
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/\d/, 'Password must contain a digit'),
});

export type SeedResult = { status: 'created' | 'exists'; email: string };

/**
 * Creates the first administrator from explicit credentials (the seed script reads
 * them from ADMIN_EMAIL / ADMIN_PASSWORD). Idempotent: never overwrites an existing
 * account. There is deliberately no public registration endpoint.
 */
export async function ensureAdmin(input: { email?: string; password?: string }): Promise<SeedResult> {
  const parsed = adminSeedSchema.safeParse(input);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid administrator credentials (${details})`);
  }

  const { email, password } = parsed.data;
  if (await Admin.exists({ email })) return { status: 'exists', email };

  await Admin.create({ email, password: await hashPassword(password) });
  return { status: 'created', email };
}
