import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * One entry per active refresh token (i.e. per logged-in device).
 * `jti` identifies the single currently-valid refresh token of a rotation chain;
 * `family` groups every token that descends from one login so a replayed
 * (already rotated) token can revoke the whole chain.
 */
const sessionSchema = new Schema(
  {
    jti: { type: String, required: true },
    family: { type: String, required: true },
    remember: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true },
    createdAt: { type: Date, default: () => new Date() },
    userAgent: { type: String, maxlength: 256 },
  },
  { _id: false },
);

const adminSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    password: { type: String, required: true, select: false }, // bcrypt hash only
    role: { type: String, enum: ['admin'], default: 'admin', required: true },
    sessions: { type: [sessionSchema], default: [], select: false },
  },
  { timestamps: true },
);

// A refresh request looks the admin up by id AND session jti.
adminSchema.index({ 'sessions.jti': 1 });

export type AdminAttrs = InferSchemaType<typeof adminSchema>;
export type AdminDocument = HydratedDocument<AdminAttrs>;
export const Admin = model('Admin', adminSchema, 'admins');
