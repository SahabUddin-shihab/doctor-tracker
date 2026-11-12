import { z } from 'zod';

export const loginSchema = z.object({
  body: z.strictObject({
    email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address').max(254)),
    password: z.string().min(1, 'Password is required').max(128),
    rememberMe: z.boolean().optional().default(false),
  }),
});

export type LoginInput = z.infer<typeof loginSchema>['body'];
