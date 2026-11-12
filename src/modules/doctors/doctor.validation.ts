import { z } from 'zod';
import {
  createdFrom,
  createdTo,
  emailField,
  idParams,
  optionalQueryText,
  paginationQuery,
  phoneField,
  refineDateRange,
  requiredText,
  sortOrder,
} from '../../utils/validation.js';

export const createDoctorSchema = z.object({
  body: z.strictObject({
    name: requiredText('Full name'),
    specialization: requiredText('Specialization'),
    hospital: requiredText('Hospital', 2, 150),
    phone: phoneField,
    email: emailField,
  }),
});

export const doctorIdSchema = z.object({ params: idParams });

export const DOCTOR_SORT_FIELDS = ['createdAt', 'name'] as const;

export const listDoctorsSchema = z.object({
  query: z
    .object({
      ...paginationQuery,
      search: optionalQueryText(100),
      specialization: optionalQueryText(100),
      hospital: optionalQueryText(150),
      createdFrom,
      createdTo,
      sortBy: z.enum(DOCTOR_SORT_FIELDS).default('createdAt'),
      sortOrder,
    })
    .superRefine(refineDateRange),
});

export const doctorOptionsSchema = z.object({
  query: z.object({
    search: optionalQueryText(100),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
});

export type CreateDoctorInput = z.infer<typeof createDoctorSchema>['body'];
export type ListDoctorsQuery = z.infer<typeof listDoctorsSchema>['query'];
export type DoctorOptionsQuery = z.infer<typeof doctorOptionsSchema>['query'];
