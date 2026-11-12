import type { Request, Response } from 'express';
import { getInput } from '../../middlewares/validate.middleware.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './patient.service.js';
import type {
  CreatePatientInput,
  ListPatientsQuery,
  UpdatePatientInput,
} from './patient.validation.js';

export async function list(req: Request, res: Response): Promise<void> {
  const { query } = getInput<{ query: ListPatientsQuery }>(req);
  const { data, meta } = await service.listPatients(query);
  sendSuccess(res, data, 'Patients retrieved successfully', { meta });
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const { params } = getInput<{ params: { id: string } }>(req);
  sendSuccess(res, await service.getPatient(params.id), 'Patient retrieved successfully');
}

export async function create(req: Request, res: Response): Promise<void> {
  const { body } = getInput<{ body: CreatePatientInput }>(req);
  const patient = await service.createPatient(body, req.admin?.id);
  sendSuccess(res, patient, 'Patient created successfully', { status: 201 });
}

export async function update(req: Request, res: Response): Promise<void> {
  const { params, body } = getInput<{ params: { id: string }; body: UpdatePatientInput }>(req);
  sendSuccess(res, await service.updatePatient(params.id, body, req.admin?.id), 'Patient updated successfully');
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { params } = getInput<{ params: { id: string } }>(req);
  await service.deletePatient(params.id, req.admin?.id);
  sendSuccess(res, null, 'Patient deleted successfully');
}

export async function conditionOptions(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.listConditionOptions(), 'Condition options retrieved successfully');
}
