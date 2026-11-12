import { describe, expect, it } from 'vitest';
import { Doctor } from '../src/modules/doctors/doctor.model.js';
import { Patient } from '../src/modules/patients/patient.model.js';
import { startOfZonedMonth, zonedTimeToUtc } from '../src/utils/time.js';
import { doctorPayload, insertDoctor, insertPatient, loginClient, patientPayload, useTestDatabase } from './helpers.js';

useTestDatabase();
const api = '/api/v1';
const TZ = 'Asia/Dhaka'; // UTC+6, matches tests/setup-env.ts

describe('timezone helpers', () => {
  it('computes month boundaries in the app timezone, not UTC', () => {
    // 2026-11-30 20:00 UTC is already 2026-12-01 02:00 in Dhaka, so it is "December" there.
    const start = startOfZonedMonth(new Date('2026-11-30T20:00:00Z'), TZ);
    expect(start.toISOString()).toBe('2026-11-30T18:00:00.000Z'); // Dec 1 00:00 +06:00
  });

  it('converts local wall-clock time to UTC', () => {
    expect(zonedTimeToUtc(2026, 3, 15, TZ).toISOString()).toBe('2026-03-14T18:00:00.000Z');
    expect(zonedTimeToUtc(2026, 7, 1, 'America/New_York').toISOString()).toBe('2026-07-01T04:00:00.000Z'); // EDT
    expect(zonedTimeToUtc(2026, 1, 1, 'America/New_York').toISOString()).toBe('2026-01-01T05:00:00.000Z'); // EST
  });
});

describe('GET /dashboard/overview', () => {
  it('handles an empty database gracefully', async () => {
    const client = await loginClient();
    const res = await client.get(`${api}/dashboard/overview`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      totals: { doctors: 0, patients: 0 },
      averagePatientsPerDoctor: 0,
      thisMonth: { doctors: 0, patients: 0 },
      doctorsWithoutPatients: 0,
    });
  });

  it('reports real totals, average and this-month counts', async () => {
    const monthStart = startOfZonedMonth(new Date(), TZ);
    const lastMonth = new Date(monthStart.getTime() - 5 * 86_400_000);

    const [a, b] = await Promise.all([
      insertDoctor(),
      Doctor.create({ ...doctorPayload(), createdAt: lastMonth }),
    ]);
    await Promise.all([insertPatient(a._id), insertPatient(a._id), insertPatient(b._id, { createdAt: lastMonth })]);

    const client = await loginClient();
    const { data } = (await client.get(`${api}/dashboard/overview`)).body;
    expect(data.totals).toEqual({ doctors: 2, patients: 3 });
    expect(data.averagePatientsPerDoctor).toBe(1.5);
    expect(data.thisMonth).toEqual({ doctors: 1, patients: 2 });
    expect(data.lastMonth).toEqual({ doctors: 1, patients: 1 });
    expect(data.timezone).toBe(TZ);
  });

  it('refreshes after mutations (no stale analytics)', async () => {
    const client = await loginClient();
    expect((await client.get(`${api}/dashboard/overview`)).body.data.totals.doctors).toBe(0);
    const doctor = await client.post(`${api}/doctors`).send(doctorPayload()).expect(201);
    const after = await client.get(`${api}/dashboard/overview`);
    expect(after.body.data.totals.doctors).toBe(1);

    const patient = await client.post(`${api}/doctors/${doctor.body.data.id}/patients`).send(patientPayload()).expect(201);
    expect((await client.get(`${api}/dashboard/overview`)).body.data.totals.patients).toBe(1);
    await client.del(`${api}/patients/${patient.body.data.id}`).expect(200);
    expect((await client.get(`${api}/dashboard/overview`)).body.data.totals.patients).toBe(0);
  });

  it('counts unassigned patients and excludes them from the per-doctor average', async () => {
    const doctor = await insertDoctor();
    await insertPatient(doctor._id);
    await insertPatient(null);
    const client = await loginClient();
    const { data } = (await client.get(`${api}/dashboard/overview`)).body;
    expect(data.unassignedPatients).toBe(1);
    expect(data.averagePatientsPerDoctor).toBe(1);
  });
});

describe('GET /dashboard/patients-per-doctor', () => {
  it('ranks doctors by patient count and includes doctors with zero patients', async () => {
    const [busy, mid, idle] = await Promise.all([
      insertDoctor({ name: 'Dr. Busy' }),
      insertDoctor({ name: 'Dr. Mid' }),
      insertDoctor({ name: 'Dr. Idle' }),
    ]);
    await Promise.all([insertPatient(busy._id), insertPatient(busy._id), insertPatient(busy._id), insertPatient(mid._id)]);
    expect(String(idle._id)).toBeTruthy();

    const client = await loginClient();
    const { data } = (await client.get(`${api}/dashboard/patients-per-doctor`)).body;
    expect(data.data.map((d: { name: string; count: number }) => [d.name, d.count])).toEqual([
      ['Dr. Busy', 3],
      ['Dr. Mid', 1],
      ['Dr. Idle', 0],
    ]);
    expect(data.totalDoctors).toBe(3);
  });

  it('respects the limit and validates it', async () => {
    const doctors = await Promise.all(Array.from({ length: 5 }, () => insertDoctor()));
    await Promise.all(doctors.map((d, i) => Promise.all(Array.from({ length: i }, () => insertPatient(d._id)))));
    const client = await loginClient();
    const res = await client.get(`${api}/dashboard/patients-per-doctor?limit=2`);
    expect(res.body.data.data.map((d: { count: number }) => d.count)).toEqual([4, 3]);
    expect(res.body.data.totalDoctors).toBe(5);
    expect((await client.get(`${api}/dashboard/patients-per-doctor?limit=500`)).status).toBe(400);
  });

  it('returns an empty list for an empty database', async () => {
    const client = await loginClient();
    expect((await client.get(`${api}/dashboard/patients-per-doctor`)).body.data.data).toEqual([]);
  });
});

describe('GET /dashboard/conditions', () => {
  it('groups conditions case-insensitively and rolls the tail into "Other"', async () => {
    const doctor = await insertDoctor();
    const conds = ['Asthma', 'asthma', 'ASTHMA', 'Migraine', 'Migraine', 'Eczema', 'Gastritis'];
    await Promise.all(conds.map((condition) => insertPatient(doctor._id, { condition })));
    const client = await loginClient();

    const { data } = (await client.get(`${api}/dashboard/conditions?limit=2`)).body;
    expect(data.total).toBe(7);
    expect(data.data.map((d: { condition: string; count: number }) => [d.condition.toLowerCase(), d.count])).toEqual([
      ['asthma', 3],
      ['migraine', 2],
      ['other', 2],
    ]);
    expect(data.data.reduce((s: number, d: { count: number }) => s + d.count, 0)).toBe(7);
  });

  it('is empty without patients', async () => {
    const client = await loginClient();
    expect((await client.get(`${api}/dashboard/conditions`)).body.data).toEqual({ data: [], total: 0 });
  });
});

describe('GET /dashboard/trends', () => {
  it('returns a zero-filled daily series of 30 points by default', async () => {
    const client = await loginClient();
    const { data } = (await client.get(`${api}/dashboard/trends`)).body;
    expect(data.period).toBe('daily');
    expect(data.series).toHaveLength(30);
    expect(data.series.every((p: { doctors: number; patients: number }) => p.doctors === 0 && p.patients === 0)).toBe(true);
  });

  it('buckets by calendar day in the app timezone (not UTC)', async () => {
    // 2026-05-10 20:00 UTC = 2026-05-11 02:00 in Dhaka -> belongs to May 11 locally.
    const doctor = await insertDoctor();
    await insertPatient(doctor._id, { createdAt: new Date('2026-05-10T20:00:00Z') });
    await insertPatient(doctor._id, { createdAt: new Date('2026-05-11T05:00:00Z') }); // May 11 11:00 local
    await insertPatient(doctor._id, { createdAt: new Date('2026-05-10T10:00:00Z') }); // May 10 16:00 local

    const client = await loginClient();
    const { data } = (await client.get(`${api}/dashboard/trends?period=daily&from=2026-05-09&to=2026-05-12`)).body;
    expect(data.series.map((p: { date: string; patients: number }) => [p.date, p.patients])).toEqual([
      ['2026-05-09', 0],
      ['2026-05-10', 1],
      ['2026-05-11', 2],
      ['2026-05-12', 0],
    ]);
    expect(data.totals.patients).toBe(3);
  });

  it('buckets weekly (Monday start) and monthly', async () => {
    const doctor = await insertDoctor();
    // Wed 2026-05-06, Sun 2026-05-10 (same ISO week, Monday 05-04) and Mon 2026-05-11 (next week)
    for (const iso of ['2026-05-06T06:00:00Z', '2026-05-10T06:00:00Z', '2026-05-11T06:00:00Z', '2026-06-02T06:00:00Z']) {
      await insertPatient(doctor._id, { createdAt: new Date(iso) });
    }
    const client = await loginClient();

    const weekly = (await client.get(`${api}/dashboard/trends?period=weekly&from=2026-05-04&to=2026-05-17`)).body.data;
    expect(weekly.series.map((p: { date: string; patients: number }) => [p.date, p.patients])).toEqual([
      ['2026-05-04', 2],
      ['2026-05-11', 1],
    ]);

    const monthly = (await client.get(`${api}/dashboard/trends?period=monthly&from=2026-04-01&to=2026-06-30`)).body.data;
    expect(monthly.series.map((p: { date: string; patients: number }) => [p.date, p.patients])).toEqual([
      ['2026-04-01', 0],
      ['2026-05-01', 3],
      ['2026-06-01', 1],
    ]);
  });

  it('tracks doctors and patients as separate series', async () => {
    const day = new Date('2026-03-05T06:00:00Z');
    const doctor = await Doctor.create({ ...doctorPayload(), createdAt: day });
    await Doctor.create({ ...doctorPayload(), createdAt: day });
    await insertPatient(doctor._id, { createdAt: day });
    const client = await loginClient();
    const { data } = (await client.get(`${api}/dashboard/trends?from=2026-03-05&to=2026-03-05`)).body;
    expect(data.series).toEqual([{ date: '2026-03-05', doctors: 2, patients: 1 }]);
  });

  it('validates period and date range', async () => {
    const client = await loginClient();
    for (const q of ['period=hourly', 'from=nonsense', 'from=2026-06-01&to=2026-05-01']) {
      expect((await client.get(`${api}/dashboard/trends?${q}`)).status, q).toBe(400);
    }
  });

  it('rejects ranges that would produce an unbounded number of points', async () => {
    const client = await loginClient();
    const res = await client.get(`${api}/dashboard/trends?period=daily&from=2020-01-01&to=2026-01-01`);
    expect(res.status).toBe(400);
  });
});

describe('GET /dashboard/recent-activity', () => {
  it('lists real events newest first and honours the limit', async () => {
    const client = await loginClient();
    const doctor = await client.post(`${api}/doctors`).send(doctorPayload({ name: 'Dr. First' })).expect(201);
    const patient = await client.post(`${api}/doctors/${doctor.body.data.id}/patients`).send(patientPayload({ name: 'Pat Second' })).expect(201);
    await client.patch(`${api}/patients/${patient.body.data.id}`).send({ age: 55 }).expect(200);

    const feed = (await client.get(`${api}/dashboard/recent-activity`)).body.data;
    expect(feed.map((e: { type: string }) => e.type)).toEqual(['patient.updated', 'patient.created', 'doctor.created']);
    expect((await client.get(`${api}/dashboard/recent-activity?limit=1`)).body.data).toHaveLength(1);
    expect((await client.get(`${api}/dashboard/recent-activity?limit=0`)).status).toBe(400);
  });

  it('does not log anything for a no-op update', async () => {
    const client = await loginClient();
    const doctor = await client.post(`${api}/doctors`).send(doctorPayload()).expect(201);
    const patient = await client.post(`${api}/doctors/${doctor.body.data.id}/patients`).send(patientPayload({ age: 40 })).expect(201);
    await client.patch(`${api}/patients/${patient.body.data.id}`).send({ age: 40 }).expect(200);
    const feed = (await client.get(`${api}/dashboard/recent-activity`)).body.data;
    expect(feed.some((e: { type: string }) => e.type === 'patient.updated')).toBe(false);
    expect(await Patient.countDocuments()).toBe(1);
  });
});
