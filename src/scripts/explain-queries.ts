/**
 * Prints the winning query plan (index used, keys/docs examined) for the API's hot queries.
 * Run it against a seeded database:  npm run explain
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../database/connection.js';
import { Doctor } from '../modules/doctors/doctor.model.js';
import { Patient } from '../modules/patients/patient.model.js';
import { buildPrefixFilter } from '../utils/search.js';

interface PlanNode {
  stage?: string;
  indexName?: string;
  inputStage?: PlanNode;
  inputStages?: PlanNode[];
}

function collectStages(node: PlanNode | undefined, out: string[] = []): string[] {
  if (!node) return out;
  out.push(node.indexName ? `${node.stage}(${node.indexName})` : (node.stage ?? '?'));
  collectStages(node.inputStage, out);
  node.inputStages?.forEach((child) => collectStages(child, out));
  return out;
}

async function report(label: string, run: () => Promise<unknown>): Promise<void> {
  const explained = (await run()) as {
    queryPlanner: { winningPlan: PlanNode };
    executionStats: { nReturned: number; totalKeysExamined: number; totalDocsExamined: number; executionTimeMillis: number };
  };
  const stats = explained.executionStats;
  console.log(`\n${label}`);
  console.log(`  plan      : ${collectStages(explained.queryPlanner.winningPlan).join(' -> ')}`);
  console.log(
    `  examined  : ${stats.totalKeysExamined} keys, ${stats.totalDocsExamined} docs  |  returned ${stats.nReturned}  |  ${stats.executionTimeMillis} ms`,
  );
}

async function main(): Promise<void> {
  await connectDatabase({ retries: 1 });
  const [doctors, patients] = await Promise.all([Doctor.estimatedDocumentCount(), Patient.estimatedDocumentCount()]);
  console.log(`Collections: ${doctors} doctors, ${patients} patients`);

  const doctorSearch = buildPrefixFilter('cardio')!;
  const patientSearch = buildPrefixFilter('hyper')!;
  const someDoctor = await Doctor.findOne({}, { _id: 1 }).lean();

  await report('doctors: search "cardio", newest first, page 1', () =>
    Doctor.find(doctorSearch).sort({ createdAt: -1, _id: -1 }).limit(10).explain('executionStats'),
  );
  await report('doctors: filter by specialization, newest first', () =>
    Doctor.find({ specialization: 'Cardiology' }).sort({ createdAt: -1, _id: -1 }).limit(10).explain('executionStats'),
  );
  await report('doctors: createdAt date range', () =>
    Doctor.find({ createdAt: { $gte: new Date(Date.now() - 30 * 864e5) } })
      .sort({ createdAt: -1, _id: -1 })
      .limit(10)
      .explain('executionStats'),
  );
  await report('patients: search "hyper", newest first', () =>
    Patient.find(patientSearch).sort({ createdAt: -1, _id: -1 }).limit(10).explain('executionStats'),
  );
  await report("patients: one doctor's list, newest first", () =>
    Patient.find({ doctor: someDoctor?._id })
      .sort({ createdAt: -1, _id: -1 })
      .limit(10)
      .explain('executionStats'),
  );
  await report('patients: condition filter, newest first', () =>
    Patient.find({ conditionKey: 'hypertension' }).sort({ createdAt: -1, _id: -1 }).limit(10).explain('executionStats'),
  );
  await report('patients: age range 30-60', () =>
    Patient.find({ age: { $gte: 30, $lte: 60 } }).limit(10).explain('executionStats'),
  );
  await report('patients: date range + gender (gender is filtered, not indexed)', () =>
    Patient.find({ createdAt: { $gte: new Date(Date.now() - 30 * 864e5) }, gender: 'female' })
      .sort({ createdAt: -1, _id: -1 })
      .limit(10)
      .explain('executionStats'),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
    await mongoose.disconnect();
  });
