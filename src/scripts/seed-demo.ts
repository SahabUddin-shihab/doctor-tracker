/**
 * Populates the database with realistic, reproducible demo data (doctors, patients and
 * their activity trail) spread over the last ~120 days, so the dashboard charts have
 * something meaningful to show.
 *
 *   npm run seed:demo            -> adds demo data (skips if doctors already exist)
 *   npm run seed:demo -- --reset -> wipes doctors/patients/activities first
 */
import { isProduction } from '../config/env.js';
import { connectDatabase, disconnectDatabase, ensureIndexes } from '../database/connection.js';
import { Activity } from '../modules/activity/activity.model.js';
import { Doctor } from '../modules/doctors/doctor.model.js';
import { Patient } from '../modules/patients/patient.model.js';

const DAY = 86_400_000;

// Deterministic PRNG so every run produces the same dataset.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(20261111);
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;

const HOSPITALS = [
  'Square Hospitals Ltd',
  'United Hospital Limited',
  'Evercare Hospital Dhaka',
  'Labaid Specialized Hospital',
  'Dhaka Medical College Hospital',
  'Popular Medical College Hospital',
];

const DOCTORS: Array<[string, string]> = [
  ['Dr. Anisur Rahman', 'Cardiology'],
  ['Dr. Farhana Haque', 'Endocrinology'],
  ['Dr. Mahmudul Hasan', 'Neurology'],
  ['Dr. Nusrat Jahan', 'Pediatrics'],
  ['Dr. Tanvir Ahmed', 'Orthopedics'],
  ['Dr. Sabrina Karim', 'Dermatology'],
  ['Dr. Imran Hossain', 'Gastroenterology'],
  ['Dr. Rashida Begum', 'Gynecology'],
  ['Dr. Kamal Uddin', 'Pulmonology'],
  ['Dr. Shirin Akter', 'Psychiatry'],
  ['Dr. Rafiqul Islam', 'Nephrology'],
  ['Dr. Maliha Chowdhury', 'Ophthalmology'],
];

const FIRST = ['Abdul', 'Rahim', 'Karim', 'Salma', 'Nadia', 'Jamal', 'Sultana', 'Hasan', 'Mita', 'Rubel', 'Tania', 'Shafiq', 'Lutfa', 'Zahid', 'Ayesha', 'Munir', 'Farzana', 'Sohel', 'Rokeya', 'Habib'];
const LAST = ['Khan', 'Chowdhury', 'Ahmed', 'Hossain', 'Sarkar', 'Mia', 'Begum', 'Das', 'Roy', 'Talukder', 'Mondal', 'Sheikh'];
const CONDITIONS = [
  ['Hypertension', 6],
  ['Type 2 Diabetes', 6],
  ['Asthma', 4],
  ['Migraine', 3],
  ['Arthritis', 3],
  ['Anxiety Disorder', 3],
  ['Coronary Artery Disease', 2],
  ['Chronic Kidney Disease', 2],
  ['Eczema', 2],
  ['Gastritis', 2],
  ['Hypothyroidism', 1],
] as const;
const WEIGHTED_CONDITIONS = CONDITIONS.flatMap(([name, weight]) => Array<string>(weight).fill(name));
const NOTES = ['Follow-up in 4 weeks.', 'Allergic to penicillin.', 'Referred by a general practitioner.', 'Prefers morning appointments.', undefined, undefined, undefined];

const slug = (value: string) => value.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '');
const phone = () => `+8801${pick(['7', '8', '9', '5', '3'])}${String(Math.floor(random() * 1e8)).padStart(8, '0')}`;

async function main(): Promise<void> {
  if (isProduction) throw new Error('Refusing to seed demo data in production');
  await connectDatabase({ retries: 1 });
  await ensureIndexes();

  if (process.argv.includes('--reset')) {
    await Promise.all([Doctor.deleteMany({}), Patient.deleteMany({}), Activity.deleteMany({})]);
    console.log('Existing doctors, patients and activities removed.');
  } else if (await Doctor.exists({})) {
    console.log('Doctors already exist - nothing to do (use --reset to start over).');
    return;
  }

  const now = Date.now();
  const doctors = await Doctor.insertMany(
    DOCTORS.map(([name, specialization], index) => ({
      name,
      specialization,
      hospital: pick(HOSPITALS),
      phone: phone(),
      email: `${slug(name.replace('Dr. ', ''))}@doctortracker.example`,
      // Older doctors first; the newest two were added this month.
      createdAt: new Date(now - (index < 10 ? (110 - index * 9) * DAY : (4 - (index - 10) * 2) * DAY)),
    })),
  );

  // Uneven workloads make the patients-per-doctor chart interesting; the last doctor stays empty.
  const weights = doctors.map((_, index) => (index === doctors.length - 1 ? 0 : 1 + ((index * 7) % 5)));
  const weighted = doctors.flatMap((doctor, index) => Array(weights[index]).fill(doctor) as typeof doctors);

  const patientDocs = Array.from({ length: 140 }, (_, index) => {
    const doctor = pick(weighted);
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    // Skew registrations towards recent weeks (more growth recently).
    const ageDays = Math.floor(Math.pow(random(), 1.6) * 118);
    const createdAt = new Date(Math.max(doctor.createdAt.getTime() + DAY, now - ageDays * DAY - Math.floor(random() * DAY)));
    return {
      name,
      email: random() > 0.35 ? `${slug(name)}${index}@mail.example` : undefined,
      phone: phone(),
      age: 4 + Math.floor(random() * 84),
      gender: pick(['male', 'female', 'female', 'male', 'other'] as const),
      condition: pick(WEIGHTED_CONDITIONS),
      notes: pick(NOTES),
      doctor: doctor._id,
      createdAt,
    };
  });
  const patients = await Patient.insertMany(patientDocs);

  await Activity.insertMany([
    ...doctors.map((doctor) => ({
      type: 'doctor.created' as const,
      entityType: 'doctor' as const,
      entityId: doctor._id,
      summary: `Doctor ${doctor.name} (${doctor.specialization}) added at ${doctor.hospital}`,
      createdAt: doctor.createdAt,
    })),
    ...patients.map((patient) => {
      const owner = doctors.find((doctor) => String(doctor._id) === String(patient.doctor));
      return {
        type: 'patient.created' as const,
        entityType: 'patient' as const,
        entityId: patient._id,
        summary: `Patient ${patient.name} registered under ${owner?.name ?? 'a doctor'}`,
        createdAt: patient.createdAt,
      };
    }),
  ]);

  console.log(`Seeded ${doctors.length} doctors and ${patients.length} patients.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
