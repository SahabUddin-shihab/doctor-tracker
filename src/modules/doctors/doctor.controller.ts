import type { Request, Response } from 'express';
import { getInput } from '../../middlewares/validate.middleware.js';
import { sendSuccess } from '../../utils/response.js';
import type { ListPatientsQuery, PatientFields } from '../patients/patient.validation.js';
import * as service from './doctor.service.js';
import type { CreateDoctorInput, DoctorOptionsQuery, ListDoctorsQuery } from './doctor.validation.js';

export async function create(req: Request, res: Response): Promise<void> {
  const { body } = getInput<{ body: CreateDoctorInput }>(req);
  sendSuccess(res, await service.createDoctor(body, req.admin?.id), 'Doctor created successfully', {
    status: 201,
  });
}

export async function list(req: Request, res: Response): Promise<void> {
  const { query } = getInput<{ query: ListDoctorsQuery }>(req);
  const { data, meta } = await service.listDoctors(query);
  sendSuccess(res, data, 'Doctors retrieved successfully', { meta });
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const { params } = getInput<{ params: { id: string } }>(req);
  sendSuccess(res, await service.getDoctor(params.id), 'Doctor retrieved successfully');
}

export async function listPatients(req: Request, res: Response): Promise<void> {
  const { params, query } = getInput<{ params: { id: string }; query: Omit<ListPatientsQuery, 'doctorId'> }>(req);
  const { data, meta } = await service.listDoctorPatients(params.id, query);
  sendSuccess(res, data, 'Doctor patients retrieved successfully', { meta });
}

export async function addPatient(req: Request, res: Response): Promise<void> {
  const { params, body } = getInput<{ params: { id: string }; body: PatientFields }>(req);
  const patient = await service.addPatientToDoctor(params.id, body, req.admin?.id);
  sendSuccess(res, patient, 'Patient added to doctor successfully', { status: 201 });
}

export async function removePatient(req: Request, res: Response): Promise<void> {
  const { params } = getInput<{ params: { id: string; patientId: string } }>(req);
  const patient = await service.removePatientFromDoctor(params.id, params.patientId, req.admin?.id);
  sendSuccess(res, patient, 'Patient removed from doctor successfully');
}

export async function options(req: Request, res: Response): Promise<void> {
  const { query } = getInput<{ query: DoctorOptionsQuery }>(req);
  sendSuccess(res, await service.listDoctorOptions(query), 'Doctor options retrieved successfully');
}

export async function filterOptions(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.listFilterOptions(), 'Filter options retrieved successfully');
}
