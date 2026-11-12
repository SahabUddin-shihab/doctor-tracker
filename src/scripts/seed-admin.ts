import { env } from '../config/env.js';
import { connectDatabase, disconnectDatabase, ensureIndexes } from '../database/connection.js';
import { ensureAdmin } from '../modules/auth/admin.seed.js';

async function main(): Promise<void> {
  await connectDatabase({ retries: 1 });
  await ensureIndexes();
  const result = await ensureAdmin({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD });
  console.log(
    result.status === 'created'
      ? `Administrator created: ${result.email}`
      : `Administrator already exists: ${result.email} (left unchanged)`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
