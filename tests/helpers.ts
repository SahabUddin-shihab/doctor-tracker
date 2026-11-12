import jwt from 'jsonwebtoken';
import mongoose, { type Types } from 'mongoose';
import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, inject } from 'vitest';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase, ensureIndexes } from '../src/database/connection.js';
import { Admin } from '../src/modules/auth/admin.model.js';
import { ensureAdmin } from '../src/modules/auth/admin.seed.js';
import { Doctor } from '../src/modules/doctors/doctor.model.js';
import { Patient } from '../src/modules/patients/patient.model.js';

export const ADMIN_EMAIL = 'admin@test.example';
export const ADMIN_PASSWORD = 'Str0ng-Test-Passw0rd';

/** Connects to the shared test MongoDB, builds indexes and wipes data before each test. */
export function useTestDatabase(): void {
  beforeAll(async () => {
    await connectDatabase({ uri: inject('mongoUri'), retries: 0 });
    await ensureIndexes();
  });
  beforeEach(async () => {
    await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
  });
  afterAll(async () => {
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await disconnectDatabase();
  });
}

export const app = createApp({ rateLimit: false });

export async function createTestAdmin(): Promise<void> {
  await ensureAdmin({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
}

export interface AuthedClient {
  agent: ReturnType<typeof supertest.agent>;
  csrf: string;
  get: (url: string) => supertest.Test;
  post: (url: string) => supertest.Test;
  patch: (url: string) => supertest.Test;
  del: (url: string) => supertest.Test;
}

function wrap(agent: ReturnType<typeof supertest.agent>, csrf: string): AuthedClient {
  return {
    agent,
    csrf,
    get: (url) => agent.get(url),
    post: (url) => agent.post(url).set('X-CSRF-Token', csrf),
    patch: (url) => agent.patch(url).set('X-CSRF-Token', csrf),
    del: (url) => agent.delete(url).set('X-CSRF-Token', csrf),
  };
}

/** Creates the admin (if needed), signs in through the real endpoint and returns a cookie-aware client. */
export async function loginClient(rememberMe = false): Promise<AuthedClient> {
  if (!(await Admin.exists({ email: ADMIN_EMAIL }))) await createTestAdmin();
  const agent = supertest.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, rememberMe });
  if (res.status !== 200) throw new Error(`Test login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return wrap(agent, res.body.data.csrfToken as string);
}

export function signExpiredAccessToken(adminId: string): string {
  return jwt.sign({ role: 'admin' }, process.env.JWT_ACCESS_SECRET as string, {
    algorithm: 'HS256',
    subject: adminId,
    issuer: 'doctor-tracker',
    audience: 'doctor-tracker:access',
    expiresIn: -60,
  });
}

let counter = 0;
export function doctorPayload(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return {
    name: `Dr. Test ${counter}`,
    specialization: 'Cardiology',
    hospital: 'City Hospital',
    phone: `+88017000000${String(counter).padStart(2, '0')}`,
    email: `doctor${counter}@example.com`,
    ...overrides,
  };
}

export function patientPayload(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return {
    name: `Patient ${counter}`,
    email: `patient${counter}@example.com`,
    phone: `01800000${String(counter).padStart(3, '0')}`,
    age: 40,
    gender: 'female',
    condition: 'Hypertension',
    notes: 'Initial visit',
    ...overrides,
  };
}

/** Inserts directly through the models (so createdAt can be controlled), bypassing HTTP. */
export async function insertDoctor(overrides: Record<string, unknown> = {}) {
  const doctor = new Doctor(doctorPayload(overrides));
  return doctor.save();
}

export async function insertPatient(doctorId: Types.ObjectId | null, overrides: Record<string, unknown> = {}) {
  const patient = new Patient({ ...patientPayload(), doctor: doctorId, ...overrides });
  return patient.save();
}
