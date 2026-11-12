import { describe, expect, it } from 'vitest';
import { Doctor } from '../src/modules/doctors/doctor.model.js';
import { Patient } from '../src/modules/patients/patient.model.js';
import {
  doctorPayload,
  insertDoctor,
  insertPatient,
  loginClient,
  patientPayload,
  useTestDatabase,
} from './helpers.js';

useTestDatabase();
const api = '/api/v1';

describe('POST /doctors', () => {
  it('creates a doctor, normalising email and phone', async () => {
    const client = await loginClient();
    const res = await client.post(`${api}/doctors`).send(doctorPayload({ email: 'MixedCase@Example.COM', phone: '+880 1711-222333' }));

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ email: 'mixedcase@example.com', phone: '+8801711222333', patientCount: 0 });
    expect(res.body.data.id).toMatch(/^[a-f0-9]{24}$/);
    expect(res.body.data).not.toHaveProperty('searchTokens');
    expect(res.body.data).not.toHaveProperty('nameKey');
  });

  it('returns field-level errors for invalid input', async () => {
    const client = await loginClient();
    const res = await client.post(`${api}/doctors`).send({ name: 'A', specialization: '', hospital: '', phone: 'abc', email: 'bad' });
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e: { path: string }) => e.path).sort()).toEqual(['email', 'hospital', 'name', 'phone', 'specialization']);
  });

  it('rejects unknown fields (mass-assignment protection)', async () => {
    const client = await loginClient();
    const res = await client.post(`${api}/doctors`).send({ ...doctorPayload(), role: 'admin', _id: 'x' });
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate email case-insensitively with 409', async () => {
    const client = await loginClient();
    await client.post(`${api}/doctors`).send(doctorPayload({ email: 'dup@example.com' })).expect(201);
    const res = await client.post(`${api}/doctors`).send(doctorPayload({ email: 'DUP@example.com' }));
    expect(res.status).toBe(409);
    expect(res.body.errors[0].path).toBe('email');
  });

  it('records an activity entry', async () => {
    const client = await loginClient();
    await client.post(`${api}/doctors`).send(doctorPayload({ name: 'Dr. Audit Trail' })).expect(201);
    const feed = await client.get(`${api}/dashboard/recent-activity`);
    expect(feed.body.data[0]).toMatchObject({ type: 'doctor.created' });
    expect(feed.body.data[0].summary).toContain('Dr. Audit Trail');
  });
});

describe('GET /doctors (list, search, filter, pagination)', () => {
  async function seed() {
    const day = 86_400_000;
    const now = Date.now();
    await Doctor.create([
      { ...doctorPayload({ name: 'Dr. Alice Heart', specialization: 'Cardiology', hospital: 'Alpha Hospital', email: 'alice@x.com' }), createdAt: new Date(now - 40 * day) },
      { ...doctorPayload({ name: 'Dr. Bob Brain', specialization: 'Neurology', hospital: 'Alpha Hospital', email: 'bob@x.com' }), createdAt: new Date(now - 20 * day) },
      { ...doctorPayload({ name: 'Dr. Carol Cardio', specialization: 'Cardiology', hospital: 'Beta Clinic', email: 'carol@x.com', phone: '+8801555000111' }), createdAt: new Date(now - 5 * day) },
      { ...doctorPayload({ name: 'Dr. Dan Skin', specialization: 'Dermatology', hospital: 'Beta Clinic', email: 'dan@x.com' }), createdAt: new Date(now - 1 * day) },
    ]);
  }

  it('returns pagination meta and newest first by default', async () => {
    await seed();
    const client = await loginClient();
    const res = await client.get(`${api}/doctors?limit=3`);
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, limit: 3, total: 4, totalPages: 2 });
    expect(res.body.data.map((d: { name: string }) => d.name)).toEqual(['Dr. Dan Skin', 'Dr. Carol Cardio', 'Dr. Bob Brain']);
  });

  it('paginates without overlap and handles the last page and an out-of-range page', async () => {
    await seed();
    const client = await loginClient();
    const p1 = await client.get(`${api}/doctors?limit=3&page=1`);
    const p2 = await client.get(`${api}/doctors?limit=3&page=2`);
    const p3 = await client.get(`${api}/doctors?limit=3&page=3`);
    const ids = [...p1.body.data, ...p2.body.data].map((d: { id: string }) => d.id);
    expect(new Set(ids).size).toBe(4);
    expect(p2.body.data).toHaveLength(1);
    expect(p3.body.data).toEqual([]);
    expect(p3.body.meta.total).toBe(4);
  });

  it('searches by word prefix across name, specialization, hospital, email and phone', async () => {
    await seed();
    const client = await loginClient();
    const names = async (q: string) =>
      (await client.get(`${api}/doctors?search=${encodeURIComponent(q)}`)).body.data.map((d: { name: string }) => d.name).sort();

    expect(await names('alice')).toEqual(['Dr. Alice Heart']);
    expect(await names('cardio')).toEqual(['Dr. Alice Heart', 'Dr. Carol Cardio']); // specialization + name prefix
    expect(await names('beta')).toEqual(['Dr. Carol Cardio', 'Dr. Dan Skin']);
    expect(await names('dan@x')).toEqual(['Dr. Dan Skin']);
    expect(await names('0155500')).toEqual(['Dr. Carol Cardio']);
    expect(await names('ALICE heart')).toEqual(['Dr. Alice Heart']); // case-insensitive, all words must match
    expect(await names('alice neuro')).toEqual([]);
  });

  it('treats regex metacharacters in the search term as plain text', async () => {
    await seed();
    const client = await loginClient();
    const res = await client.get(`${api}/doctors?search=${encodeURIComponent('.*')}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('shows a clear empty result for searches with no matches', async () => {
    await seed();
    const client = await loginClient();
    const res = await client.get(`${api}/doctors?search=zzzz`);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta).toMatchObject({ total: 0, totalPages: 0 });
  });

  it('combines specialization, hospital and search filters', async () => {
    await seed();
    const client = await loginClient();
    const bySpec = await client.get(`${api}/doctors?specialization=Cardiology`);
    expect(bySpec.body.meta.total).toBe(2);
    const combined = await client.get(`${api}/doctors?specialization=Cardiology&hospital=Beta%20Clinic`);
    expect(combined.body.data.map((d: { name: string }) => d.name)).toEqual(['Dr. Carol Cardio']);
    const all3 = await client.get(`${api}/doctors?specialization=Cardiology&hospital=Beta%20Clinic&search=carol`);
    expect(all3.body.meta.total).toBe(1);
    const none = await client.get(`${api}/doctors?specialization=Neurology&hospital=Beta%20Clinic`);
    expect(none.body.meta.total).toBe(0);
  });

  it('filters by created date range (date-only bounds are inclusive, in the app timezone)', async () => {
    await seed();
    const client = await loginClient();
    const day = 86_400_000;
    const iso = (d: number) => new Date(Date.now() - d * day).toISOString().slice(0, 10);

    const recent = await client.get(`${api}/doctors?createdFrom=${iso(10)}`);
    expect(recent.body.data.map((d: { name: string }) => d.name).sort()).toEqual(['Dr. Carol Cardio', 'Dr. Dan Skin']);
    const middle = await client.get(`${api}/doctors?createdFrom=${iso(25)}&createdTo=${iso(15)}`);
    expect(middle.body.data.map((d: { name: string }) => d.name)).toEqual(['Dr. Bob Brain']);
    const sameDay = await client.get(`${api}/doctors?createdFrom=${iso(5)}&createdTo=${iso(5)}`);
    expect(sameDay.body.data.map((d: { name: string }) => d.name)).toEqual(['Dr. Carol Cardio']);
  });

  it('keeps filters and search consistent with pagination totals', async () => {
    await seed();
    const client = await loginClient();
    const res = await client.get(`${api}/doctors?specialization=Cardiology&limit=1&page=2`);
    expect(res.body.meta).toEqual({ page: 2, limit: 1, total: 2, totalPages: 2 });
    expect(res.body.data).toHaveLength(1);
  });

  it('sorts by name', async () => {
    await seed();
    const client = await loginClient();
    const res = await client.get(`${api}/doctors?sortBy=name&sortOrder=asc`);
    expect(res.body.data.map((d: { name: string }) => d.name)).toEqual(['Dr. Alice Heart', 'Dr. Bob Brain', 'Dr. Carol Cardio', 'Dr. Dan Skin']);
  });

  it('validates query parameters', async () => {
    const client = await loginClient();
    for (const q of ['limit=0', 'limit=101', 'page=0', 'page=abc', 'createdFrom=yesterday', 'createdFrom=2026-02-31', 'sortBy=password', 'createdFrom=2026-05-02&createdTo=2026-05-01']) {
      const res = await client.get(`${api}/doctors?${q}`);
      expect(res.status, q).toBe(400);
    }
  });

  it('includes the number of associated patients (without N+1 queries)', async () => {
    const a = await insertDoctor({ name: 'Dr. Busy' });
    const b = await insertDoctor({ name: 'Dr. Idle' });
    await Promise.all([insertPatient(a._id), insertPatient(a._id), insertPatient(a._id)]);
    const client = await loginClient();
    const res = await client.get(`${api}/doctors?sortBy=name&sortOrder=asc`);
    const counts = Object.fromEntries(res.body.data.map((d: { name: string; patientCount: number }) => [d.name, d.patientCount]));
    expect(counts).toEqual({ 'Dr. Busy': 3, 'Dr. Idle': 0 });
    expect(String(b._id)).toBeTruthy();
  });
});

describe('GET /doctors/:id', () => {
  it('returns the doctor with the patient count', async () => {
    const doctor = await insertDoctor();
    await insertPatient(doctor._id);
    const client = await loginClient();
    const res = await client.get(`${api}/doctors/${doctor._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: String(doctor._id), patientCount: 1 });
  });

  it('returns 400 for an invalid id and 404 for a missing doctor', async () => {
    const client = await loginClient();
    expect((await client.get(`${api}/doctors/123`)).status).toBe(400);
    expect((await client.get(`${api}/doctors/64b7f0f2f2f2f2f2f2f2f2f2`)).status).toBe(404);
  });
});

describe('doctor ↔ patient relationship', () => {
  it('adds a patient to a doctor and lists them', async () => {
    const doctor = await insertDoctor();
    const client = await loginClient();

    const created = await client.post(`${api}/doctors/${doctor._id}/patients`).send(patientPayload({ name: 'Rina Rahman' }));
    expect(created.status).toBe(201);
    expect(created.body.data.doctor).toMatchObject({ id: String(doctor._id), name: doctor.name });

    const list = await client.get(`${api}/doctors/${doctor._id}/patients`);
    expect(list.status).toBe(200);
    expect(list.body.data.map((p: { name: string }) => p.name)).toEqual(['Rina Rahman']);
    expect(list.body.meta.total).toBe(1);
    expect((await client.get(`${api}/doctors/${doctor._id}`)).body.data.patientCount).toBe(1);
  });

  it("only lists the selected doctor's patients and supports their own search/filter/pagination", async () => {
    const [a, b] = await Promise.all([insertDoctor(), insertDoctor()]);
    await insertPatient(a._id, { name: 'Alpha One', condition: 'Asthma' });
    await insertPatient(a._id, { name: 'Alpha Two', condition: 'Asthma' });
    await insertPatient(a._id, { name: 'Alpha Three', condition: 'Migraine' });
    await insertPatient(b._id, { name: 'Beta One' });
    const client = await loginClient();

    expect((await client.get(`${api}/doctors/${a._id}/patients`)).body.meta.total).toBe(3);
    expect((await client.get(`${api}/doctors/${a._id}/patients?condition=asthma`)).body.meta.total).toBe(2);
    expect((await client.get(`${api}/doctors/${a._id}/patients?search=three`)).body.data).toHaveLength(1);
    const page = await client.get(`${api}/doctors/${a._id}/patients?limit=2&page=2`);
    expect(page.body.data).toHaveLength(1);
    expect(page.body.meta).toMatchObject({ total: 3, totalPages: 2 });
  });

  it('returns 404 when adding to / listing a doctor that does not exist', async () => {
    const client = await loginClient();
    const ghost = '64b7f0f2f2f2f2f2f2f2f2f2';
    expect((await client.post(`${api}/doctors/${ghost}/patients`).send(patientPayload())).status).toBe(404);
    expect((await client.get(`${api}/doctors/${ghost}/patients`)).status).toBe(404);
  });

  it('removes a patient from a doctor without deleting the patient or the doctor', async () => {
    const doctor = await insertDoctor();
    const patient = await insertPatient(doctor._id, { name: 'Unlinked Una' });
    const client = await loginClient();

    const res = await client.del(`${api}/doctors/${doctor._id}/patients/${patient._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.doctor).toBeNull();

    expect((await client.get(`${api}/doctors/${doctor._id}/patients`)).body.data).toEqual([]);
    expect((await client.get(`${api}/doctors/${doctor._id}`)).body.data.patientCount).toBe(0);
    expect(await Doctor.countDocuments({ _id: doctor._id })).toBe(1);
    expect(await Patient.countDocuments({ _id: patient._id })).toBe(1); // record kept, now unassigned

    const unassigned = await client.get(`${api}/patients?doctorId=unassigned`);
    expect(unassigned.body.data.map((p: { name: string }) => p.name)).toEqual(['Unlinked Una']);
  });

  it("returns 404 when the patient does not belong to that doctor", async () => {
    const [a, b] = await Promise.all([insertDoctor(), insertDoctor()]);
    const patient = await insertPatient(a._id);
    const client = await loginClient();
    const res = await client.del(`${api}/doctors/${b._id}/patients/${patient._id}`);
    expect(res.status).toBe(404);
    expect(String((await Patient.findById(patient._id))?.doctor)).toBe(String(a._id)); // untouched
  });
});
