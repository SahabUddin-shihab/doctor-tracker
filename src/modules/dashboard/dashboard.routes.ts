import { Router } from 'express';
import { validate } from '../../middlewares/validate.middleware.js';
import * as controller from './dashboard.controller.js';
import {
  conditionsSchema,
  patientsPerDoctorSchema,
  recentActivitySchema,
  trendsSchema,
} from './dashboard.validation.js';

// Authentication/authorization are applied once, where the router is mounted (app.ts).
export const dashboardRouter = Router();

dashboardRouter.get('/overview', controller.overview);
dashboardRouter.get('/patients-per-doctor', validate(patientsPerDoctorSchema), controller.patientsPerDoctor);
dashboardRouter.get('/trends', validate(trendsSchema), controller.trends);
dashboardRouter.get('/conditions', validate(conditionsSchema), controller.conditions);
dashboardRouter.get('/recent-activity', validate(recentActivitySchema), controller.recentActivity);
