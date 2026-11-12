import { z } from 'zod';
import {
  createdFrom,
  createdTo,
  emailField,
  idParams,
  objectId,
  optionalQueryText,
  paginationQuery,
  phoneField,
  refineDateRange,
  requiredText,
  sortOrder,
} from '../../utils/validation.js';
import { GENDERS } from './patient.model.js';

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

const age = z.number({ error: 'Age must be a number' }).int('Age must be a whole number').min(0, 'Age cannot be negative').max(130, 'Enter a realistic age');
const gender = z.enum(GENDERS, { error: 'Select a gender' });
const notes = z.string().trim().max(2000, 'Notes must be at most 2000 characters');

/** Create: empty strings for optional fields mean "not provided". */
const optionalEmail = z.union([z.literal('').transform(() => undefined), emailField]).optional();
const optionalNotes = notes.optional().transform((value) => value || undefined);

/** Update: null or "" clears the field. */
const clearableEmail = z
  .union([z.literal(''), z.null(), emailField])
  .transform((value) => (value === '' ? null : value))
  .optional();
const clearableNotes = z
  .union([notes, z.null()])
  .transform((value) => (value === '' ? null : value))
  .optional();

const patientFields = {
  name: requiredText('Name'),
  email: optionalEmail,
  phone: phoneField,
  age,
  gender,
  condition: requiredText('Medical condition', 2, 150),
  notes: optionalNotes,
};

export const createPatientSchema = z.object({
  body: z.strictObject({ ...patientFields, doctorId: objectId }),
});

/** Body for POST /doctors/:id/patients (the doctor comes from the URL). */
export const addPatientToDoctorSchema = z.object({
  params: idParams,
  body: z.strictObject(patientFields),
});

export const updatePatientSchema = z.object({
  params: idParams,
  body: z
    .strictObject({
      name: patientFields.name.optional(),
      email: clearableEmail,
      phone: patientFields.phone.optional(),
      age: age.optional(),
      gender: gender.optional(),
      condition: patientFields.condition.optional(),
      notes: clearableNotes,
      doctorId: objectId.optional(),
    })
    .refine((body) => Object.values(body).some((value) => value !== undefined), {
      message: 'Provide at least one field to update',
    }),
});

export const patientIdSchema = z.object({ params: idParams });

export const removePatientSchema = z.object({
  params: z.object({ id: objectId, patientId: objectId }),
});

export const PATIENT_SORT_FIELDS = ['createdAt', 'name', 'age'] as const;

const listBase = z.object({
  ...paginationQuery,
  search: optionalQueryText(100),
  condition: optionalQueryText(150),
  gender: z.preprocess(emptyToUndefined, z.enum(GENDERS).optional()),
  ageMin: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(130).optional()),
  ageMax: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(130).optional()),
  createdFrom,
  createdTo,
  sortBy: z.enum(PATIENT_SORT_FIELDS).default('createdAt'),
  sortOrder,
});

type ListBase = z.infer<typeof listBase>;

function refineRanges(value: ListBase, ctx: z.RefinementCtx) {
  refineDateRange(value, ctx);
  if (value.ageMin !== undefined && value.ageMax !== undefined && value.ageMin > value.ageMax) {
    ctx.addIssue({ code: 'custom', path: ['ageMin'], message: 'Minimum age must not exceed maximum age' });
  }
}

/** doctorId may be an ObjectId or the literal "unassigned". */
const doctorFilter = z.preprocess(
  emptyToUndefined,
  z.union([objectId, z.literal('unassigned')]).optional(),
);

export const listPatientsSchema = z.object({
  query: listBase.extend({ doctorId: doctorFilter }).superRefine(refineRanges),
});

export const listDoctorPatientsSchema = z.object({
  params: idParams,
  query: listBase.superRefine(refineRanges),
});

export type PatientFields = z.infer<typeof addPatientToDoctorSchema>['body'];
export type CreatePatientInput = z.infer<typeof createPatientSchema>['body'];
export type UpdatePatientInput = z.infer<typeof updatePatientSchema>['body'];
export type ListPatientsQuery = z.infer<typeof listPatientsSchema>['query'];
