import type { Types } from 'mongoose';
import { logger } from '../../config/logger.js';
import { Activity, type ActivityType } from './activity.model.js';

interface ActivityInput {
  type: ActivityType;
  entityType: 'doctor' | 'patient';
  entityId: Types.ObjectId | string;
  summary: string;
  actorId?: string;
}

/**
 * Records an audit event. A failure to write the audit trail must never fail the
 * business operation that already succeeded, so errors are logged and swallowed.
 */
export async function recordActivity(input: ActivityInput): Promise<void> {
  try {
    await Activity.create({
      type: input.type,
      entityType: input.entityType,
      entityId: input.entityId,
      summary: input.summary,
      actor: input.actorId,
    });
  } catch (error) {
    logger.error({ err: error, type: input.type }, 'Failed to record activity');
  }
}

export async function listRecentActivity(limit: number) {
  const rows = await Activity.find({}, { type: 1, entityType: 1, entityId: 1, summary: 1, createdAt: 1 })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return rows.map((row) => ({
    id: String(row._id),
    type: row.type,
    entityType: row.entityType,
    entityId: String(row.entityId),
    summary: row.summary,
    createdAt: row.createdAt,
  }));
}
