import { Router } from 'express';
import { validate } from '../../middlewares/validate.middleware.js';
import * as controller from './patient.controller.js';
import {
  createPatientSchema,
  listPatientsSchema,
  patientIdSchema,
  updatePatientSchema,
} from './patient.validation.js';

// Authentication/authorization are applied once, where the router is mounted (app.ts).
export const patientRouter = Router();

patientRouter.get('/', validate(listPatientsSchema), controller.list);
patientRouter.get('/filter-options', controller.conditionOptions); // before "/:id"
patientRouter.get('/:id', validate(patientIdSchema), controller.getOne);
patientRouter.post('/', validate(createPatientSchema), controller.create);
patientRouter.put('/:id', validate(updatePatientSchema), controller.update);
patientRouter.patch('/:id', validate(updatePatientSchema), controller.update); // kept for backward compatibility
patientRouter.delete('/:id', validate(patientIdSchema), controller.remove);