import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import {
  emailTokens,
  normalizeText,
  phoneTokens,
  tokenize,
  toKey,
  uniqueTokens,
} from '../../utils/search.js';

export const GENDERS = ['male', 'female', 'other'] as const;

const patientSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    age: { type: Number, required: true, min: 0, max: 130, validate: Number.isInteger },
    gender: { type: String, required: true, enum: GENDERS },
    condition: { type: String, required: true, trim: true, minlength: 2, maxlength: 150 },
    notes: { type: String, trim: true, maxlength: 2000 },
    /**
     * Reference to the treating doctor (never a copy of the doctor's data).
     * Required whenever a patient is created or edited through the API. It becomes
     * `null` only when an administrator explicitly removes the patient from a
     * doctor's list (DELETE /doctors/:id/patients/:patientId), after which the
     * patient shows as "Unassigned" until re-assigned.
     */
    doctor: { type: Schema.Types.ObjectId, ref: 'Doctor', default: null },

    // Derived, query-only fields (never returned by the API).
    searchTokens: { type: [String], default: [], select: false },
    nameKey: { type: String, select: false },
    conditionKey: { type: String, select: false },
  },
  { timestamps: true },
);

patientSchema.pre('validate', function computeDerivedFields() {
  this.nameKey = normalizeText(this.name);
  this.conditionKey = toKey(this.condition);
  this.searchTokens = uniqueTokens(
    tokenize(this.name),
    tokenize(this.condition),
    emailTokens(this.email),
    phoneTokens(this.phone),
  );
});

/*
 * Index design (driven by the queries in patient.service.ts and dashboard.service.ts):
 *
 *  doctor + createdAt        doctor's patient list, per-doctor counts ($lookup/$group), "assigned doctor" filter
 *  conditionKey + createdAt  condition filter and the condition-distribution $group
 *  searchTokens              word-prefix search (matched set is sorted in memory; see doctor.model.ts)
 *  createdAt                 date-range filter, default sort, monthly/trend aggregations
 *  age                       age-range filter and "sort by age"
 *  nameKey                   "sort by name"
 *
 * Gender is intentionally NOT indexed on its own: with three values it is not
 * selective, so MongoDB filters it on the documents the other indexes already narrowed.
 */
patientSchema.index({ doctor: 1, createdAt: -1 });
patientSchema.index({ conditionKey: 1, createdAt: -1 });
patientSchema.index({ searchTokens: 1 });
patientSchema.index({ createdAt: -1 });
patientSchema.index({ age: 1 });
patientSchema.index({ nameKey: 1 });

export type PatientAttrs = InferSchemaType<typeof patientSchema>;
export type PatientDocument = HydratedDocument<PatientAttrs>;
export const Patient = model('Patient', patientSchema, 'patients');
