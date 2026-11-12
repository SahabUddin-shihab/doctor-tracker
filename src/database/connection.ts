import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

mongoose.set('strictQuery', true);

let listenersAttached = false;

function attachListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  mongoose.connection.on('error', (error) => logger.error({ err: error }, 'MongoDB connection error'));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface ConnectOptions {
  uri?: string;
  retries?: number;
  retryDelayMs?: number;
}

/**
 * Connects with bounded retries so a database that is still starting does not
 * crash the API immediately; after the last attempt the error is thrown to the caller.
 */
export async function connectDatabase(options: ConnectOptions = {}): Promise<void> {
  const { uri = env.MONGODB_URI, retries = 5, retryDelayMs = 2_000 } = options;
  attachListeners();

  for (let attempt = 1; ; attempt += 1) {
    try {
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 5_000,
        maxPoolSize: 20,
        minPoolSize: 2,
      });
      logger.info('MongoDB connected');
      return;
    } catch (error) {
      if (attempt > retries) throw error;
      logger.warn(
        { attempt, retries, err: error instanceof Error ? error.message : error },
        'MongoDB connection failed, retrying',
      );
      await sleep(retryDelayMs * attempt);
    }
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

/** 1 = connected. Used by the health endpoint. */
export const isDatabaseConnected = (): boolean => mongoose.connection.readyState === 1;

/** Builds all declared indexes (idempotent). Called at startup so unique constraints are always enforced. */
export async function ensureIndexes(): Promise<void> {
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
}
