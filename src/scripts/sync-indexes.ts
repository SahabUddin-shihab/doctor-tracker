/**
 * Makes the database's indexes match the schemas exactly: creates missing ones AND drops
 * indexes that are no longer declared. Run it deliberately after changing index definitions
 * (the API itself only ever creates indexes at startup, it never drops them).
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../database/connection.js';
import '../modules/activity/activity.model.js';
import '../modules/auth/admin.model.js';
import '../modules/doctors/doctor.model.js';
import '../modules/patients/patient.model.js';

async function main(): Promise<void> {
  await connectDatabase({ retries: 1 });
  for (const model of Object.values(mongoose.models)) {
    const dropped = await model.syncIndexes();
    console.log(`${model.collection.name}: ${dropped.length ? `dropped ${dropped.join(', ')}` : 'in sync'}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
