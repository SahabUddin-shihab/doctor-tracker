import { describe, expect, it } from 'vitest';
import { Activity } from '../src/modules/activity/activity.model.js';
import { Doctor } from '../src/modules/doctors/doctor.model.js';
import { Patient } from '../src/modules/patients/patient.model.js';
import { insertDoctor, insertPatient, loginClient, patientPayload, useTestDatabase } from './helpers.js';

useTestDatabase();
const api = '/api/v1';
const ghost = '64b7f0f2f2f2f2f2f2f2f2f2';

describe('POST /patients', () => {
  it('creates a patient linked to a doctor by reference', async () => {
    const doctor = await insertDoctor();
    const client = await loginClient();
    const res = await client.post(`${api}/patients`).send({ ...patientPayload(), doctorId: String(doctor._id) });

    expect(res.status).toBe(201);
    expect(res.body.data.doctor).toEqual({ id: String(doctor._id), name: doctor.name, specialization: doctor.specialization });

    const stored = await Patient.findById(res.body.data.id).lean();
    expect(String(stored?.doctor)).toBe(String(doctor._id)); // ObjectId reference only
    expect(Object.keys(stored ?? {})).not.toContain('doctorName');
  });

  it('accepts a patient with no email or notes', async () => {
    const doctor = await insertDoctor();
    const client = await loginClient();
    const { email: _e, notes: _n, ...rest } = patientPayload();
    const res = await client.post(`${api}/patients`).send({ ...rest, email: '', doctorId: String(doctor._id) });
    expect(res.status).toBe(201);
    expect(res.body.data.email).toBeNull();
    expect(res.body.data.notes).toBeNull();
  });

  it('rejects invalid data with field-level errors', async () => {
    const doctor = await insertDoctor();
    const client = await loginClient();
    const res = await client.post(`${api}/patients`).send({
      name: '',
      email: 'bad',
      phone: '12',
      age: -3,
      gender: 'robot',
      condition: '',
      doctorId: String(doctor._id),
    });
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e: { path: string }) => e.path).sort()).toEqual(['age', 'condition', 'email', 'gender', 'name', 'phone']);
  });

  it.each([
    ['a string', '41'],
    ['a decimal', 40.5],
    ['too large', 131],
  ])('rejects an age that is %s', async (_label, age) => {
    const doctor = await insertDoctor();
    const client = await loginClient();
    const res = await client.post(`${api}/patients`).send({ ...patientPayload({ age }), doctorId: String(doctor._id) });
    expect(res.status).toBe(400);
    expect(res.body.errors[0].path).toBe('age');
  });

  it('requires a doctor and validates its id', async () => {
    const client = await loginClient();
    expect((await client.post(`${api}/patients`).send(patientPayload())).status).toBe(400);
    expect((await client.post(`${api}/patients`).send({ ...patientPayload(), doctorId: 'nope' })).status).toBe(400);
  });

  it('rejects a doctor that does not exist (422) and stores nothing', async () => {
    const client = await loginClient();
    const res = await client.post(`${api}/patients`).send({ ...patientPayload(), doctorId: ghost });
    expect(res.status).toBe(422);
    expect(res.body.errors[0].path).toBe('doctorId');
    expect(await Patient.countDocuments()).toBe(0);
  });
});

describe('GET /patients (list, search, filters, pagination)', () => {
  async function seed() {
    const [heart, brain] = await Promise.all([
      insertDoctor({ name: 'Dr. Helena Heart', specialization: 'Cardiology' }),
      insertDoctor({ name: 'Dr. Boris Brain', specialization: 'Neurology' }),
    ]);
    const day = 86_400_000;
    const now = Date.now();
    await Patient.insertMany([
      { ...patientPayload({ name: 'Anna Young', age: 12, gender: 'female', condition: 'Asthma', email: 'anna@mail.com', phone: '01711000001' }), doctor: heart._id, createdAt: new Date(now - 30 * day) },
      { ...patientPayload({ name: 'Bill Middle', age: 45, gender: 'male', condition: 'Hypertension', email: 'bill@mail.com', phone: '01711000002' }), doctor: heart._id, createdAt: new Date(now - 10 * day) },
      { ...patientPayload({ name: 'Cara Senior', age: 78, gender: 'female', condition: 'hypertension', email: undefined, phone: '01711000003' }), doctor: brain._id, createdAt: new Date(now - 3 * day) },
      { ...patientPayload({ name: 'Dev Other', age: 33, gender: 'other', condition: 'Migraine', email: 'dev@mail.com', phone: '01711000004' }), doctor: brain._id, createdAt: new Date(now - 1 * day) },
    ]);
    return { heart, brain };
  }
  const names = (res: { body: { data: Array<{ name: string }> } }) => res.body.data.map((p) => p.name).sort();

  it('lists patients newest first with the assigned doctor and meta', async () => {
    await seed();
    const client = await loginClient();
    const res = await client.get(`${api}/patients`);
    expect(res.body.meta).toEqual({ page: 1, limit: 10, total: 4, totalPages: 1 });
    expect(res.body.data[0].name).toBe('Dev Other');
    expect(res.body.data[0].doctor).toMatchObject({ name: 'Dr. Boris Brain' });
  });

  it('searches name, phone, email, condition and assigned doctor name', async () => {
    await seed();
    const client = await loginClient();
    expect(names(await client.get(`${api}/patients?search=anna`))).toEqual(['Anna Young']);
    expect(names(await client.get(`${api}/patients?search=0171100000`))).toHaveLength(4);
    expect(names(await client.get(`${api}/patients?search=0171100000${3}`))).toEqual(['Cara Senior']);
    expect(names(await client.get(`${api}/patients?search=bill@mail`))).toEqual(['Bill Middle']);
    expect(names(await client.get(`${api}/patients?search=hyper`))).toEqual(['Bill Middle', 'Cara Senior']);
    expect(names(await client.get(`${api}/patients?search=boris`))).toEqual(['Cara Senior', 'Dev Other']); // by doctor
    expect(names(await client.get(`${api}/patients?search=zzz`))).toEqual([]);
  });

  it('filters by condition case-insensitively', async () => {
    await seed();
    const client = await loginClient();
    expect(names(await client.get(`${api}/patients?condition=HYPERTENSION`))).toEqual(['Bill Middle', 'Cara Senior']);
  });

  it('filters by gender, assigned doctor and age range', async () => {
    const { heart } = await seed();
    const client = await loginClient();
    expect(names(await client.get(`${api}/patients?gender=female`))).toEqual(['Anna Young', 'Cara Senior']);
    expect(names(await client.get(`${api}/patients?doctorId=${heart._id}`))).toEqual(['Anna Young', 'Bill Middle']);
    expect(names(await client.get(`${api}/patients?ageMin=30&ageMax=50`))).toEqual(['Bill Middle', 'Dev Other']);
    expect(names(await client.get(`${api}/patients?ageMin=60`))).toEqual(['Cara Senior']);
    expect(names(await client.get(`${api}/patients?ageMax=12`))).toEqual(['Anna Young']);
  });

  it('filters by created date range', async () => {
    await seed();
    const client = await loginClient();
    const iso = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
    expect(names(await client.get(`${api}/patients?createdFrom=${iso(5)}`))).toEqual(['Cara Senior', 'Dev Other']);
    expect(names(await client.get(`${api}/patients?createdFrom=${iso(15)}&createdTo=${iso(5)}`))).toEqual(['Bill Middle']);
  });

  it('applies every filter together', async () => {
    const { brain } = await seed();
    const client = await loginClient();
    const res = await client.get(`${api}/patients?search=hyper&gender=female&doctorId=${brain._id}&ageMin=60&condition=hypertension&createdFrom=${new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)}`);
    expect(names(res)).toEqual(['Cara Senior']);
    const miss = await client.get(`${api}/patients?search=hyper&gender=male&doctorId=${brain._id}`);
    expect(miss.body.meta.total).toBe(0);
  });

  it('paginates server-side and keeps filters in the totals', async () => {
    await seed();
    const client = await loginClient();
    const res = await client.get(`${api}/patients?gender=female&limit=1&page=2`);
    expect(res.body.meta).toEqual({ page: 2, limit: 1, total: 2, totalPages: 2 });
    expect(res.body.data).toHaveLength(1);
  });

  it('sorts by age and name', async () => {
    await seed();
    const client = await loginClient();
    const byAge = await client.get(`${api}/patients?sortBy=age&sortOrder=desc`);
    expect(byAge.body.data.map((p: { age: number }) => p.age)).toEqual([78, 45, 33, 12]);
    const byName = await client.get(`${api}/patients?sortBy=name&sortOrder=asc`);
    expect(byName.body.data[0].name).toBe('Anna Young');
  });

  it('validates filter parameters', async () => {
    const client = await loginClient();
    for (const q of ['gender=robot', 'ageMin=-1', 'ageMax=500', 'ageMin=50&ageMax=10', 'doctorId=abc', 'limit=1000', 'createdFrom=garbage']) {
      expect((await client.get(`${api}/patients?${q}`)).status, q).toBe(400);
    }
  });

  it('never interprets operator-style query parameters', async () => {
    await seed();
    const client = await loginClient();
    // If `gender[$ne]=male` were parsed as {gender:{$ne:'male'}} it would exclude the male patient (3 rows).
    // It is treated as an unknown literal key and ignored, so the filter has no effect at all.
    const res = await client.get(`${api}/patients?gender[$ne]=male`);
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(4);

    const nested = await client.get(`${api}/patients?search[$regex]=.*`);
    expect(nested.status).toBe(200);
    expect(nested.body.meta.total).toBe(4);

    // A real operator-shaped key is rejected outright by the injection guard.
    expect((await client.get(`${api}/patients?$where=1`)).status).toBe(400);
  });

  it('matches nothing for a search made only of punctuation', async () => {
    await seed();
    const client = await loginClient();
    expect((await client.get(`${api}/patients?search=${encodeURIComponent('.*')}`)).body.meta.total).toBe(0);
    expect((await client.get(`${api}/patients?search=%20%20`)).body.meta.total).toBe(4); // blank = no search
  });

  it('exposes distinct, case-merged condition options for the filter dropdown', async () => {
    await seed();
    const client = await loginClient();
    const res = await client.get(`${api}/patients/filter-options`);
    const hyper = res.body.data.find((c: { value: string }) => c.value === 'hypertension');
    expect(hyper.count).toBe(2);
    expect(res.body.data).toHaveLength(3);
  });
});

describe('GET /patients/:id', () => {
  it('returns one patient', async () => {
    const doctor = await insertDoctor();
    const patient = await insertPatient(doctor._id, { name: 'Single Sam' });
    const client = await loginClient();
    const res = await client.get(`${api}/patients/${patient._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Single Sam', doctor: { name: doctor.name } });
  });

  it('handles invalid and missing ids', async () => {
    const client = await loginClient();
    expect((await client.get(`${api}/patients/xyz`)).status).toBe(400);
    expect((await client.get(`${api}/patients/${ghost}`)).status).toBe(404);
  });
});

describe('PATCH /patients/:id', () => {
  it('updates fields, returns the new state and logs an activity', async () => {
    const doctor = await insertDoctor();
    const patient = await insertPatient(doctor._id, { name: 'Old Name', age: 30 });
    const client = await loginClient();

    const res = await client.patch(`${api}/patients/${patient._id}`).send({ name: 'New Name', age: 31, condition: 'Asthma', notes: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'New Name', age: 31, condition: 'Asthma', notes: 'Updated' });
    expect(await Activity.countDocuments({ type: 'patient.updated' })).toBe(1);
  });

  it('keeps search and filters in sync after an edit (derived fields are recomputed)', async () => {
    const doctor = await insertDoctor();
    const patient = await insertPatient(doctor._id, { name: 'Before Name', condition: 'Asthma' });
    const client = await loginClient();
    await client.patch(`${api}/patients/${patient._id}`).send({ name: 'Zelda After', condition: 'Migraine' }).expect(200);

    expect((await client.get(`${api}/patients?search=before`)).body.meta.total).toBe(0);
    expect((await client.get(`${api}/patients?search=zelda`)).body.meta.total).toBe(1);
    expect((await client.get(`${api}/patients?condition=asthma`)).body.meta.total).toBe(0);
    expect((await client.get(`${api}/patients?condition=migraine`)).body.meta.total).toBe(1);
  });

  it('re-assigns the patient to another doctor and updates both doctors\' counts', async () => {
    const [a, b] = await Promise.all([insertDoctor(), insertDoctor()]);
    const patient = await insertPatient(a._id);
    const client = await loginClient();

    const res = await client.patch(`${api}/patients/${patient._id}`).send({ doctorId: String(b._id) });
    expect(res.status).toBe(200);
    expect(res.body.data.doctor.id).toBe(String(b._id));
    expect((await client.get(`${api}/doctors/${a._id}`)).body.data.patientCount).toBe(0);
    expect((await client.get(`${api}/doctors/${b._id}`)).body.data.patientCount).toBe(1);
  });

  it('re-assigns an unassigned patient', async () => {
    const [a, b] = await Promise.all([insertDoctor(), insertDoctor()]);
    const patient = await insertPatient(a._id);
    const client = await loginClient();
    await client.del(`${api}/doctors/${a._id}/patients/${patient._id}`).expect(200);
    const res = await client.patch(`${api}/patients/${patient._id}`).send({ doctorId: String(b._id) });
    expect(res.body.data.doctor.id).toBe(String(b._id));
  });

  it('can clear optional email and notes', async () => {
    const doctor = await insertDoctor();
    const patient = await insertPatient(doctor._id, { email: 'keep@mail.com', notes: 'something' });
    const client = await loginClient();
    const res = await client.patch(`${api}/patients/${patient._id}`).send({ email: '', notes: null });
    expect(res.body.data.email).toBeNull();
    expect(res.body.data.notes).toBeNull();
  });

  it('rejects invalid updates, an empty patch and a nonexistent target doctor', async () => {
    const doctor = await insertDoctor();
    const patient = await insertPatient(doctor._id);
    const client = await loginClient();
    expect((await client.patch(`${api}/patients/${patient._id}`).send({ age: 999 })).status).toBe(400);
    expect((await client.patch(`${api}/patients/${patient._id}`).send({})).status).toBe(400);
    expect((await client.patch(`${api}/patients/${patient._id}`).send({ doctorId: 'bad' })).status).toBe(400);
    const missingDoctor = await client.patch(`${api}/patients/${patient._id}`).send({ doctorId: ghost });
    expect(missingDoctor.status).toBe(422);
    expect(String((await Patient.findById(patient._id))?.doctor)).toBe(String(doctor._id));
  });

  it('returns 404 for a missing patient and rejects unknown fields', async () => {
    const doctor = await insertDoctor();
    const patient = await insertPatient(doctor._id);
    const client = await loginClient();
    expect((await client.patch(`${api}/patients/${ghost}`).send({ name: 'Nobody' })).status).toBe(404);
    expect((await client.patch(`${api}/patients/${patient._id}`).send({ createdAt: '2000-01-01' })).status).toBe(400);
  });
});

describe('DELETE /patients/:id', () => {
  it('deletes the patient but never the doctor, and updates counts and activity', async () => {
    const doctor = await insertDoctor();
    const patient = await insertPatient(doctor._id, { name: 'Gone Gary' });
    await insertPatient(doctor._id);
    const client = await loginClient();

    const res = await client.del(`${api}/patients/${patient._id}`);
    expect(res.status).toBe(200);
    expect(await Patient.countDocuments({ _id: patient._id })).toBe(0);
    expect(await Doctor.countDocuments({ _id: doctor._id })).toBe(1);
    expect((await client.get(`${api}/doctors/${doctor._id}`)).body.data.patientCount).toBe(1);
    expect((await client.get(`${api}/dashboard/overview`)).body.data.totals.patients).toBe(1);

    const feed = await client.get(`${api}/dashboard/recent-activity`);
    expect(feed.body.data[0]).toMatchObject({ type: 'patient.deleted' });
    expect(feed.body.data[0].summary).toContain('Gone Gary');
  });

  it('returns 404 when deleting twice and 400 for an invalid id', async () => {
    const doctor = await insertDoctor();
    const patient = await insertPatient(doctor._id);
    const client = await loginClient();
    expect((await client.del(`${api}/patients/${patient._id}`)).status).toBe(200);
    expect((await client.del(`${api}/patients/${patient._id}`)).status).toBe(404);
    expect((await client.del(`${api}/patients/xyz`)).status).toBe(400);
  });
});
