import type { PipelineStage, Types } from 'mongoose';
import { env } from '../../config/env.js';
import { badRequest } from '../../utils/errors.js';
import {
  addDaysToKey,
  addMonthsToKey,
  firstOfMonthKey,
  localDateKey,
  mondayOfKey,
  parseBoundary,
  startOfZonedMonth,
  zonedTimeToUtc,
} from '../../utils/time.js';
import { listRecentActivity } from '../activity/activity.service.js';
import { Doctor } from '../doctors/doctor.model.js';
import { Patient } from '../patients/patient.model.js';
import { cached } from './dashboard.cache.js';
import type { TrendPeriod, TrendsQuery } from './dashboard.validation.js';

const TZ = env.APP_TIMEZONE;
const MAX_BUCKETS = 400;

const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

/* ------------------------------------------------------------------ overview */

export function getOverview() {
  return cached('overview', async () => {
    const now = new Date();
    const monthStart = startOfZonedMonth(now, TZ);
    const previousMonthStart = startOfZonedMonth(now, TZ, -1);

    // All independent counts run concurrently; each one is index-backed or metadata-only.
    const [
      totalDoctors,
      totalPatients,
      unassignedPatients,
      doctorsWithPatients,
      doctorsThisMonth,
      patientsThisMonth,
      doctorsLastMonth,
      patientsLastMonth,
    ] = await Promise.all([
      Doctor.estimatedDocumentCount(),
      Patient.estimatedDocumentCount(),
      Patient.countDocuments({ doctor: null }),
      Patient.aggregate<{ n: number }>([
        { $match: { doctor: { $ne: null } } },
        { $group: { _id: '$doctor' } },
        { $count: 'n' },
      ]),
      Doctor.countDocuments({ createdAt: { $gte: monthStart } }),
      Patient.countDocuments({ createdAt: { $gte: monthStart } }),
      Doctor.countDocuments({ createdAt: { $gte: previousMonthStart, $lt: monthStart } }),
      Patient.countDocuments({ createdAt: { $gte: previousMonthStart, $lt: monthStart } }),
    ]);

    const assignedPatients = totalPatients - unassignedPatients;
    return {
      totals: { doctors: totalDoctors, patients: totalPatients },
      averagePatientsPerDoctor: totalDoctors > 0 ? round(assignedPatients / totalDoctors, 1) : 0,
      thisMonth: { doctors: doctorsThisMonth, patients: patientsThisMonth },
      lastMonth: { doctors: doctorsLastMonth, patients: patientsLastMonth },
      doctorsWithoutPatients: totalDoctors - (doctorsWithPatients[0]?.n ?? 0),
      unassignedPatients,
      timezone: TZ,
      monthStart: monthStart.toISOString(),
    };
  });
}

/* --------------------------------------------------------- patients per doctor */

interface DoctorCount {
  doctorId: string;
  name: string;
  specialization: string;
  count: number;
}

export function getPatientsPerDoctor(limit: number) {
  return cached(`patients-per-doctor:${limit}`, async () => {
    const [top, totalDoctors] = await Promise.all([
      Patient.aggregate<{ _id: Types.ObjectId; count: number; doctor: { name: string; specialization: string } }>([
        { $match: { doctor: { $ne: null } } },
        { $group: { _id: '$doctor', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: limit },
        // Join only the <= `limit` winners to their doctor documents.
        {
          $lookup: {
            from: 'doctors',
            localField: '_id',
            foreignField: '_id',
            pipeline: [{ $project: { name: 1, specialization: 1 } }],
            as: 'doctor',
          },
        },
        { $unwind: '$doctor' },
      ]),
      Doctor.estimatedDocumentCount(),
    ]);

    const rows: DoctorCount[] = top.map((row) => ({
      doctorId: String(row._id),
      name: row.doctor.name,
      specialization: row.doctor.specialization,
      count: row.count,
    }));

    // Fewer winners than the limit means every doctor with patients is already listed;
    // top up with doctors who have none so they appear in the chart with a zero bar.
    if (rows.length < limit) {
      const zero = await Doctor.find({ _id: { $nin: top.map((row) => row._id) } }, { name: 1, specialization: 1 })
        .sort({ nameKey: 1, _id: 1 })
        .limit(limit - rows.length)
        .lean();
      rows.push(...zero.map((doctor) => ({ doctorId: String(doctor._id), name: doctor.name, specialization: doctor.specialization, count: 0 })));
    }

    return { data: rows, totalDoctors, shown: rows.length };
  });
}

/* ------------------------------------------------------------------- trends */

function defaultFromKey(period: TrendPeriod, toKey: string): string {
  switch (period) {
    case 'daily':
      return addDaysToKey(toKey, -29); // last 30 days
    case 'weekly':
      return mondayOfKey(addDaysToKey(toKey, -7 * 11)); // last 12 weeks
    case 'monthly':
      return addMonthsToKey(firstOfMonthKey(toKey), -11); // last 12 months
  }
}

/** Calendar keys (local bucket start dates) covering [fromKey, toKey]. */
function bucketKeys(period: TrendPeriod, fromKey: string, toKey: string): string[] {
  const keys: string[] = [];
  let cursor = period === 'daily' ? fromKey : period === 'weekly' ? mondayOfKey(fromKey) : firstOfMonthKey(fromKey);
  while (cursor <= toKey) {
    keys.push(cursor);
    if (keys.length > MAX_BUCKETS) {
      throw badRequest(`Date range is too large for ${period} trends (max ${MAX_BUCKETS} points)`);
    }
    cursor = period === 'daily' ? addDaysToKey(cursor, 1) : period === 'weekly' ? addDaysToKey(cursor, 7) : addMonthsToKey(cursor, 1);
  }
  return keys;
}

const UNIT: Record<TrendPeriod, 'day' | 'week' | 'month'> = { daily: 'day', weekly: 'week', monthly: 'month' };

function trendPipeline(period: TrendPeriod, start: Date, end: Date): PipelineStage[] {
  return [
    { $match: { createdAt: { $gte: start, $lte: end } } }, // index: createdAt
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%d',
            timezone: TZ,
            date: {
              $dateTrunc: {
                date: '$createdAt',
                unit: UNIT[period],
                timezone: TZ,
                ...(period === 'weekly' ? { startOfWeek: 'monday' } : {}),
              },
            },
          },
        },
        count: { $sum: 1 },
      },
    },
  ];
}

export function getTrends(query: TrendsQuery) {
  const { period, createdFrom: from, createdTo: to } = query;
  const key = `trends:${period}:${from?.toISOString() ?? ''}:${to?.toISOString() ?? ''}`;

  return cached(key, async () => {
    const toKey = localDateKey(to ?? new Date(), TZ);
    const fromKey = from ? localDateKey(from, TZ) : defaultFromKey(period, toKey);
    const keys = bucketKeys(period, fromKey, toKey);

    const [startYear, startMonth, startDay] = (keys[0] as string).split('-').map(Number) as [number, number, number];
    const rangeStart = zonedTimeToUtc(startYear, startMonth, startDay, TZ);
    const rangeEnd = parseBoundary(toKey, 'end', TZ) as Date;

    const [doctorRows, patientRows] = await Promise.all([
      Doctor.aggregate<{ _id: string; count: number }>(trendPipeline(period, rangeStart, rangeEnd)),
      Patient.aggregate<{ _id: string; count: number }>(trendPipeline(period, rangeStart, rangeEnd)),
    ]);

    const doctors = new Map(doctorRows.map((row) => [row._id, row.count]));
    const patients = new Map(patientRows.map((row) => [row._id, row.count]));

    const series = keys.map((date) => ({ date, doctors: doctors.get(date) ?? 0, patients: patients.get(date) ?? 0 }));
    return {
      period,
      from: keys[0] as string,
      to: toKey,
      timezone: TZ,
      series,
      totals: {
        doctors: series.reduce((sum, point) => sum + point.doctors, 0),
        patients: series.reduce((sum, point) => sum + point.patients, 0),
      },
    };
  });
}

/* --------------------------------------------------------------- conditions */

export function getConditionDistribution(limit: number) {
  return cached(`conditions:${limit}`, async () => {
    const [top, total] = await Promise.all([
      Patient.aggregate<{ _id: string; label: string; count: number }>([
        { $group: { _id: '$conditionKey', label: { $first: '$condition' }, count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: limit },
      ]),
      Patient.estimatedDocumentCount(),
    ]);

    const data = top.map((row) => ({ key: row._id, condition: row.label, count: row.count }));
    const covered = data.reduce((sum, row) => sum + row.count, 0);
    if (total > covered) data.push({ key: '__other', condition: 'Other', count: total - covered });
    return { data, total };
  });
}

/* ----------------------------------------------------------- recent activity */

export function getRecentActivity(limit: number) {
  return cached(`recent-activity:${limit}`, () => listRecentActivity(limit));
}
