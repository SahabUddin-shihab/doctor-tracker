import { MongoMemoryServer } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

let memoryServer: MongoMemoryServer | undefined;

/**
 * Provides a MongoDB for the whole test run. Set TEST_MONGODB_URI (e.g. mongodb://127.0.0.1:27017)
 * to reuse a server you already run; otherwise a throw-away in-memory server is started
 * (mongodb-memory-server downloads a mongod binary on first use, or honours MONGOMS_SYSTEM_BINARY).
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const external = process.env.TEST_MONGODB_URI;
  if (external) {
    project.provide('mongoUri', `${external.replace(/\/$/, '')}/doctor-tracker-test-${process.pid}`);
  } else {
    memoryServer = await MongoMemoryServer.create();
    project.provide('mongoUri', `${memoryServer.getUri()}doctor-tracker-test`);
  }

  return async () => {
    if (memoryServer) await memoryServer.stop();
  };
}
