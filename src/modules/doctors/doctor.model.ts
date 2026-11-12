import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { emailTokens, normalizeText, phoneTokens, tokenize, uniqueTokens } from '../../utils/search.js';

const doctorSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    specialization: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    hospital: { type: String, required: true, trim: true, minlength: 2, maxlength: 150 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },

    // Derived, query-only fields (never returned by the API).
    searchTokens: { type: [String], default: [], select: false },
    nameTokens: { type: [String], default: [], select: false },
    nameKey: { type: String, select: false },
  },
  { timestamps: true },
);

doctorSchema.pre('validate', function computeDerivedFields() {
  this.nameTokens = tokenize(this.name);
  this.nameKey = normalizeText(this.name);
  this.searchTokens = uniqueTokens(
    this.nameTokens,
    tokenize(this.specialization),
    tokenize(this.hospital),
    emailTokens(this.email),
    phoneTokens(this.phone),
  );
});

/*
 * Index design (driven by the queries in doctor.service.ts):
 *
 *  email                       unique constraint + duplicate check
 *  searchTokens                word-prefix search (anchored regex => tight index bounds). A prefix spans
 *                              several token ranges, so MongoDB sorts the (small) matched set in memory;
 *                              a trailing createdAt key would not avoid that, so it is not included.
 *  nameTokens                  patient search by assigned-doctor name (resolves doctor ids)
 *  createdAt                   date-range filter and default sort when no search is active
 *  specialization + createdAt  specialization filter with sorted pagination
 *  hospital + createdAt        hospital filter with sorted pagination
 *  nameKey                     "sort by name" in the list view
 */
doctorSchema.index({ email: 1 }, { unique: true });
doctorSchema.index({ searchTokens: 1 });
doctorSchema.index({ nameTokens: 1 });
doctorSchema.index({ createdAt: -1 });
doctorSchema.index({ specialization: 1, createdAt: -1 });
doctorSchema.index({ hospital: 1, createdAt: -1 });
doctorSchema.index({ nameKey: 1 });

export type DoctorAttrs = InferSchemaType<typeof doctorSchema>;
export type DoctorDocument = HydratedDocument<DoctorAttrs>;
export const Doctor = model('Doctor', doctorSchema, 'doctors');
