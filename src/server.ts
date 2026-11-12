import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDatabase, disconnectDatabase, ensureIndexes } from './database/connection.js';

async function main(): Promise<void> {
  try {
    await connectDatabase();
  } catch (error) {
    logger.fatal({ err: error }, 'Could not connect to MongoDB. Is it running and is MONGODB_URI correct?');
    process.exit(1);
  }
  await ensureIndexes();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`API listening on http://localhost:${env.PORT}/api/v1 (${env.NODE_ENV})`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received, shutting down`);
    server.close(() => {
      disconnectDatabase()
        .catch((error) => logger.error({ err: error }, 'Error while disconnecting MongoDB'))
        .finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref(); // force-exit if connections hang
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'Unhandled promise rejection'));
}

void main();
