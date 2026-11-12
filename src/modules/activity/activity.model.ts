import { Schema, model, type InferSchemaType } from 'mongoose';

export const ACTIVITY_TYPES = [
  'doctor.created',
  'patient.created',
  'patient.updated',
  'patient.deleted',
  'patient.unassigned',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/**
 * Append-only audit trail powering the dashboard's "Recent activity" feed.
 * `summary` is a human-readable snapshot written at event time, so the feed is
 * a single indexed read with no joins (and still makes sense after a delete).
 */
const activitySchema = new Schema(
  {
    type: { type: String, required: true, enum: ACTIVITY_TYPES },
    entityType: { type: String, required: true, enum: ['doctor', 'patient'] },
    entityId: { type: Schema.Types.ObjectId, required: true },
    summary: { type: String, required: true, maxlength: 300 },
    actor: { type: Schema.Types.ObjectId, ref: 'Admin' },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);

// One index does two jobs: the TTL keeps the collection bounded (events older than 180 days
// are removed by MongoDB itself) and a reverse scan of it serves the newest-first feed.
activitySchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60, name: 'createdAt_ttl' });

export type ActivityAttrs = InferSchemaType<typeof activitySchema>;
export const Activity = model('Activity', activitySchema, 'activities');
