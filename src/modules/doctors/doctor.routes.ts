import { Router } from 'express';
import { validate } from '../../middlewares/validate.middleware.js';
import {
  addPatientToDoctorSchema,
  listDoctorPatientsSchema,
  removePatientSchema,
} from '../patients/patient.validation.js';
import * as controller from './doctor.controller.js';
import {
  createDoctorSchema,
  doctorIdSchema,
  doctorOptionsSchema,
  listDoctorsSchema,
} from './doctor.validation.js';

// Authentication/authorization are applied once, where the router is mounted (app.ts).
export const doctorRouter = Router();

doctorRouter.post('/', validate(createDoctorSchema), controller.create);
doctorRouter.get('/', validate(listDoctorsSchema), controller.list);
// Static paths must be registered before "/:id".
doctorRouter.get('/options', validate(doctorOptionsSchema), controller.options);
doctorRouter.get('/filter-options', controller.filterOptions);
doctorRouter.get('/:id', validate(doctorIdSchema), controller.getOne);
doctorRouter.get('/:id/patients', validate(listDoctorPatientsSchema), controller.listPatients);
doctorRouter.post('/:id/patients', validate(addPatientToDoctorSchema), controller.addPatient);
doctorRouter.delete('/:id/patients/:patientId', validate(removePatientSchema), controller.removePatient);
