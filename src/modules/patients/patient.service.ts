import type { QueryFilter, SortOrder } from 'mongoose';
import { Types } from 'mongoose';
import { buildMeta, type PaginationMeta } from '../../utils/response.js';
import { notFound, unprocessable } from '../../utils/errors.js';
import { buildPrefixFilter, toKey } from '../../utils/search.js';
import { createdAtRange } from '../../utils/validation.js';
import { recordActivity } from '../activity/activity.service.js';
import { invalidateDashboardCache } from '../dashboard/dashboard.cache.js';
import { Doctor } from '../doctors/doctor.model.js';
import { Patient, type PatientAttrs } from './patient.model.js';
import type {
  CreatePatientInput,
  ListPatientsQuery,
  PatientFields,
  UpdatePatientInput,
} from './patient.validation.js';

type PatientFilter = QueryFilter<PatientAttrs>;

export interface PatientDTO {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  age: number;
  gender: string;
  condition: string;
  notes: string | null;
  doctor: { id: string; name: string; specialization: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

interface PopulatedPatient {
  _id: Types.ObjectId;
  name: string;
  email?: string | null;
  phone: string;
  age: number;
  gender: string;
  condition: string;
  notes?: string | null;
  doctor?: { _id: Types.ObjectId; name: string; specialization: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

const DOCTOR_SUMMARY_FIELDS = 'name specialization';

function toDTO(row: PopulatedPatient): PatientDTO {
  return {
    id: String(row._id),
    name: row.name,
    email: row.email ?? null,
    phone: row.phone,
    age: row.age,
    gender: row.gender,
    condition: row.condition,
    notes: row.notes ?? null,
    doctor: row.doctor
      ? { id: String(row.doctor._id), name: row.doctor.name, specialization: row.doctor.specialization }
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadDTO(id: Types.ObjectId | string): Promise<PatientDTO> {
  const row = await Patient.findById(id).populate('doctor', DOCTOR_SUMMARY_FIELDS).lean<PopulatedPatient>();
  if (!row) throw notFound('Patient not found');
  return toDTO(row);
}

/** Unfiltered totals use the collection metadata; filtered totals use an index-backed count. */
function countFor(filter: PatientFilter): Promise<number> {
  return Object.keys(filter).length === 0 ? Patient.estimatedDocumentCount() : Patient.countDocuments(filter);
}

async function buildFilter(query: ListPatientsQuery & { doctorId?: string }): Promise<PatientFilter> {
  const and: PatientFilter[] = [];

  if (query.search) {
    const own = buildPrefixFilter(query.search);
    if (own) {
      // "Assigned doctor name" is searched by first resolving matching doctor ids (one
      // bounded, indexed query) instead of joining every patient to its doctor.
      const doctorMatch = buildPrefixFilter(query.search, 'nameTokens');
      const doctorIds = doctorMatch
        ? await Doctor.find(doctorMatch as QueryFilter<unknown>, { _id: 1 }).limit(100).lean()
        : [];
      and.push(
        (doctorIds.length > 0
          ? { $or: [own, { doctor: { $in: doctorIds.map((doctor) => doctor._id) } }] }
          : own) as PatientFilter,
      );
    }
  }

  if (query.condition) and.push({ conditionKey: toKey(query.condition) } as PatientFilter);
  if (query.gender) and.push({ gender: query.gender });
  if (query.doctorId === 'unassigned') and.push({ doctor: null });
  else if (query.doctorId) and.push({ doctor: new Types.ObjectId(query.doctorId) });
  if (query.ageMin !== undefined || query.ageMax !== undefined) {
    and.push({
      age: {
        ...(query.ageMin !== undefined ? { $gte: query.ageMin } : {}),
        ...(query.ageMax !== undefined ? { $lte: query.ageMax } : {}),
      },
    });
  }
  const range = createdAtRange(query.createdFrom, query.createdTo);
  if (range) and.push({ createdAt: range });

  if (and.length === 0) return {};
  return and.length === 1 ? (and[0] as PatientFilter) : { $and: and };
}

function buildSort(query: ListPatientsQuery): Record<string, SortOrder> {
  const direction: SortOrder = query.sortOrder === 'asc' ? 1 : -1;
  const field = query.sortBy === 'name' ? 'nameKey' : query.sortBy;
  // _id is a deterministic tiebreaker so pages never overlap or skip rows.
  return { [field]: direction, _id: direction };
}

export async function listPatients(
  query: ListPatientsQuery,
): Promise<{ data: PatientDTO[]; meta: PaginationMeta }> {
  const filter = await buildFilter(query);
  const [rows, total] = await Promise.all([
    Patient.find(filter)
      .sort(buildSort(query))
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .populate('doctor', DOCTOR_SUMMARY_FIELDS) // one extra $in query for the whole page, not one per row
      .lean<PopulatedPatient[]>(),
    countFor(filter),
  ]);
  return { data: rows.map(toDTO), meta: buildMeta(query.page, query.limit, total) };
}

export async function getPatient(id: string): Promise<PatientDTO> {
  return loadDTO(id);
}

async function requireDoctor(doctorId: string): Promise<{ _id: Types.ObjectId; name: string }> {
  const doctor = await Doctor.findById(doctorId, { name: 1 }).lean();
  if (!doctor) {
    throw unprocessable('Selected doctor does not exist', [
      { path: 'doctorId', message: 'Selected doctor does not exist' },
    ]);
  }
  return doctor;
}

export async function createPatient(
  input: PatientFields & { doctorId: string } | CreatePatientInput,
  actorId?: string,
): Promise<PatientDTO> {
  const doctor = await requireDoctor(input.doctorId);
  const { doctorId: _doctorId, ...fields } = input;
  const patient = await Patient.create({ ...fields, doctor: doctor._id });

  await recordActivity({
    type: 'patient.created',
    entityType: 'patient',
    entityId: patient._id,
    summary: `Patient ${patient.name} registered under ${doctor.name}`,
    actorId,
  });
  invalidateDashboardCache();
  return loadDTO(patient._id);
}

const SCALAR_FIELDS = ['name', 'phone', 'age', 'gender', 'condition'] as const;
const CLEARABLE_FIELDS = ['email', 'notes'] as const;

export async function updatePatient(id: string, patch: UpdatePatientInput, actorId?: string): Promise<PatientDTO> {
  const patient = await Patient.findById(id);
  if (!patient) throw notFound('Patient not found');

  const changed: string[] = [];
  for (const field of SCALAR_FIELDS) {
    const next = patch[field];
    if (next !== undefined && patient.get(field) !== next) {
      patient.set(field, next);
      changed.push(field);
    }
  }
  for (const field of CLEARABLE_FIELDS) {
    const next = patch[field];
    if (next === undefined) continue;
    const current = patient.get(field) ?? null;
    if (current !== next) {
      patient.set(field, next ?? undefined);
      changed.push(field);
    }
  }

  let newDoctorName: string | undefined;
  if (patch.doctorId !== undefined && String(patient.doctor ?? '') !== patch.doctorId) {
    const doctor = await requireDoctor(patch.doctorId);
    patient.doctor = doctor._id;
    newDoctorName = doctor.name;
    changed.push('doctor');
  }

  if (changed.length === 0) return loadDTO(patient._id);

  await patient.save();
  await recordActivity({
    type: 'patient.updated',
    entityType: 'patient',
    entityId: patient._id,
    summary: newDoctorName
      ? `Patient ${patient.name} reassigned to ${newDoctorName}${changed.length > 1 ? ` and updated (${changed.filter((f) => f !== 'doctor').join(', ')})` : ''}`
      : `Patient ${patient.name} updated (${changed.join(', ')})`,
    actorId,
  });
  invalidateDashboardCache();
  return loadDTO(patient._id);
}

export async function deletePatient(id: string, actorId?: string): Promise<void> {
  const patient = await Patient.findByIdAndDelete(id).select('name').lean();
  if (!patient) throw notFound('Patient not found');

  await recordActivity({
    type: 'patient.deleted',
    entityType: 'patient',
    entityId: patient._id,
    summary: `Patient record for ${patient.name} deleted`,
    actorId,
  });
  invalidateDashboardCache();
}

/** Distinct conditions (case-insensitively grouped, most common first) for the filter dropdown. */
export async function listConditionOptions(): Promise<Array<{ value: string; label: string; count: number }>> {
  const rows = await Patient.aggregate<{ _id: string; label: string; count: number }>([
    { $group: { _id: '$conditionKey', label: { $first: '$condition' }, count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: 200 },
  ]);
  return rows.map((row) => ({ value: row._id, label: row.label, count: row.count }));
}
