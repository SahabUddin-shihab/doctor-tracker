import type { PipelineStage, QueryFilter } from 'mongoose';
import { Types } from 'mongoose';
import { conflict, notFound } from '../../utils/errors.js';
import { buildMeta, type PaginationMeta } from '../../utils/response.js';
import { buildPrefixFilter } from '../../utils/search.js';
import { createdAtRange } from '../../utils/validation.js';
import { recordActivity } from '../activity/activity.service.js';
import { invalidateDashboardCache } from '../dashboard/dashboard.cache.js';
import { Patient } from '../patients/patient.model.js';
import * as patientService from '../patients/patient.service.js';
import type { PatientDTO } from '../patients/patient.service.js';
import type { ListPatientsQuery, PatientFields } from '../patients/patient.validation.js';
import { Doctor, type DoctorAttrs } from './doctor.model.js';
import type { CreateDoctorInput, DoctorOptionsQuery, ListDoctorsQuery } from './doctor.validation.js';

type DoctorFilter = QueryFilter<DoctorAttrs>;

export interface DoctorDTO {
  id: string;
  name: string;
  specialization: string;
  hospital: string;
  phone: string;
  email: string;
  patientCount: number;
  createdAt: Date;
  updatedAt: Date;
}

interface DoctorRow {
  _id: Types.ObjectId;
  name: string;
  specialization: string;
  hospital: string;
  phone: string;
  email: string;
  patientCount: number;
  createdAt: Date;
  updatedAt: Date;
}

function toDTO(row: DoctorRow): DoctorDTO {
  return {
    id: String(row._id),
    name: row.name,
    specialization: row.specialization,
    hospital: row.hospital,
    phone: row.phone,
    email: row.email,
    patientCount: row.patientCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;

export async function createDoctor(input: CreateDoctorInput, actorId?: string): Promise<DoctorDTO> {
  let doctor;
  try {
    doctor = await Doctor.create(input);
  } catch (error) {
    if (isDuplicateKey(error)) {
      throw conflict('A doctor with this email already exists', [
        { path: 'email', message: 'A doctor with this email already exists' },
      ]);
    }
    throw error;
  }

  await recordActivity({
    type: 'doctor.created',
    entityType: 'doctor',
    entityId: doctor._id,
    summary: `Doctor ${doctor.name} (${doctor.specialization}) added at ${doctor.hospital}`,
    actorId,
  });
  invalidateDashboardCache();
  return toDTO({ ...doctor.toObject(), patientCount: 0 });
}

function buildFilter(query: ListDoctorsQuery): DoctorFilter {
  const and: DoctorFilter[] = [];
  if (query.search) {
    const search = buildPrefixFilter(query.search);
    if (search) and.push(search as DoctorFilter);
  }
  if (query.specialization) and.push({ specialization: query.specialization });
  if (query.hospital) and.push({ hospital: query.hospital });
  const range = createdAtRange(query.createdFrom, query.createdTo);
  if (range) and.push({ createdAt: range });

  if (and.length === 0) return {};
  return and.length === 1 ? (and[0] as DoctorFilter) : { $and: and };
}

export async function listDoctors(query: ListDoctorsQuery): Promise<{ data: DoctorDTO[]; meta: PaginationMeta }> {
  const filter = buildFilter(query);
  const direction: 1 | -1 = query.sortOrder === 'asc' ? 1 : -1;
  const sort: Record<string, 1 | -1> = {
    [query.sortBy === 'name' ? 'nameKey' : 'createdAt']: direction,
    _id: direction,
  };

  // Paginate FIRST, then count patients for just the rows on this page: one aggregation,
  // an index-backed join on patients.doctor, and no per-row queries (no N+1).
  const pipeline: PipelineStage[] = [
    { $match: filter as Record<string, unknown> },
    { $sort: sort },
    { $skip: (query.page - 1) * query.limit },
    { $limit: query.limit },
    {
      $lookup: {
        from: 'patients',
        localField: '_id',
        foreignField: 'doctor',
        pipeline: [{ $count: 'n' }],
        as: 'patientStats',
      },
    },
    {
      $project: {
        name: 1,
        specialization: 1,
        hospital: 1,
        phone: 1,
        email: 1,
        createdAt: 1,
        updatedAt: 1,
        patientCount: { $ifNull: [{ $arrayElemAt: ['$patientStats.n', 0] }, 0] },
      },
    },
  ];

  const [rows, total] = await Promise.all([
    Doctor.aggregate<DoctorRow>(pipeline),
    Object.keys(filter).length === 0 ? Doctor.estimatedDocumentCount() : Doctor.countDocuments(filter),
  ]);
  return { data: rows.map(toDTO), meta: buildMeta(query.page, query.limit, total) };
}

export async function getDoctor(id: string): Promise<DoctorDTO> {
  const [doctor, patientCount] = await Promise.all([
    Doctor.findById(id).lean(),
    Patient.countDocuments({ doctor: new Types.ObjectId(id) }),
  ]);
  if (!doctor) throw notFound('Doctor not found');
  return toDTO({ ...doctor, patientCount });
}

async function requireDoctor(id: string): Promise<{ _id: Types.ObjectId; name: string }> {
  const doctor = await Doctor.findById(id, { name: 1 }).lean();
  if (!doctor) throw notFound('Doctor not found');
  return doctor;
}

export async function listDoctorPatients(
  doctorId: string,
  query: Omit<ListPatientsQuery, 'doctorId'>,
): Promise<{ data: PatientDTO[]; meta: PaginationMeta }> {
  await requireDoctor(doctorId);
  return patientService.listPatients({ ...query, doctorId });
}

export async function addPatientToDoctor(
  doctorId: string,
  fields: PatientFields,
  actorId?: string,
): Promise<PatientDTO> {
  await requireDoctor(doctorId);
  return patientService.createPatient({ ...fields, doctorId }, actorId);
}

/**
 * Removes a patient from this doctor's list. The patient record is kept and becomes
 * "Unassigned" (doctor = null) so that no clinical data is lost; it can be re-assigned
 * from the patient edit form, or deleted via DELETE /patients/:id.
 */
export async function removePatientFromDoctor(
  doctorId: string,
  patientId: string,
  actorId?: string,
): Promise<PatientDTO> {
  const doctor = await requireDoctor(doctorId);
  const patient = await Patient.findOneAndUpdate(
    { _id: patientId, doctor: doctor._id },
    { $set: { doctor: null } },
    { returnDocument: 'after' },
  ).lean();
  if (!patient) throw notFound('Patient not found for this doctor');

  await recordActivity({
    type: 'patient.unassigned',
    entityType: 'patient',
    entityId: patient._id,
    summary: `Patient ${patient.name} removed from ${doctor.name}'s patient list`,
    actorId,
  });
  invalidateDashboardCache();
  return patientService.getPatient(patientId);
}

export async function listDoctorOptions(query: DoctorOptionsQuery) {
  const filter = query.search ? buildPrefixFilter(query.search) : null;
  const rows = await Doctor.find((filter ?? {}) as DoctorFilter, { name: 1, specialization: 1, hospital: 1 })
    .sort({ nameKey: 1, _id: 1 })
    .limit(query.limit)
    .lean();
  return rows.map((row) => ({
    id: String(row._id),
    name: row.name,
    specialization: row.specialization,
    hospital: row.hospital,
  }));
}

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

export async function listFilterOptions(): Promise<{ specializations: string[]; hospitals: string[] }> {
  const [specializations, hospitals] = await Promise.all([
    Doctor.distinct('specialization'),
    Doctor.distinct('hospital'),
  ]);
  return {
    specializations: (specializations as string[]).sort(byText).slice(0, 200),
    hospitals: (hospitals as string[]).sort(byText).slice(0, 200),
  };
}
