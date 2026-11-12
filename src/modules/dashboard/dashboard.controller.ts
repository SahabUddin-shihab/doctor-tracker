import type { Request, Response } from 'express';
import { getInput } from '../../middlewares/validate.middleware.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './dashboard.service.js';
import type { TrendsQuery } from './dashboard.validation.js';

export async function overview(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.getOverview(), 'Dashboard overview retrieved successfully');
}

export async function patientsPerDoctor(req: Request, res: Response): Promise<void> {
  const { query } = getInput<{ query: { limit: number } }>(req);
  sendSuccess(res, await service.getPatientsPerDoctor(query.limit), 'Patients per doctor retrieved successfully');
}

export async function trends(req: Request, res: Response): Promise<void> {
  const { query } = getInput<{ query: TrendsQuery }>(req);
  sendSuccess(res, await service.getTrends(query), 'Trends retrieved successfully');
}

export async function conditions(req: Request, res: Response): Promise<void> {
  const { query } = getInput<{ query: { limit: number } }>(req);
  sendSuccess(res, await service.getConditionDistribution(query.limit), 'Condition distribution retrieved successfully');
}

export async function recentActivity(req: Request, res: Response): Promise<void> {
  const { query } = getInput<{ query: { limit: number } }>(req);
  sendSuccess(res, await service.getRecentActivity(query.limit), 'Recent activity retrieved successfully');
}
