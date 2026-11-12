import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env, isTest } from './config/env.js';
import { logger } from './config/logger.js';
import { isDatabaseConnected } from './database/connection.js';
import { authenticate } from './middlewares/auth.middleware.js';
import { requireRole } from './middlewares/authorization.middleware.js';
import { csrfProtection } from './middlewares/csrf.middleware.js';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware.js';
import { apiLimiter } from './middlewares/rate-limit.middleware.js';
import { rejectOperatorInjection } from './middlewares/validate.middleware.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { doctorRouter } from './modules/doctors/doctor.routes.js';
import { patientRouter } from './modules/patients/patient.routes.js';

export interface AppOptions {
  /** Defaults to on everywhere except the test environment. */
  rateLimit?: boolean;
}

export function createApp(options: AppOptions = {}): Express {
  const rateLimit = options.rateLimit ?? !isTest;
  const app = express();

  app.disable('x-powered-by');
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);

  app.use(helmet());
  // Request logging comes first so that CORS preflight (OPTIONS) requests are visible in the log too.
  if (!isTest) {
    app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url?.endsWith('/health') ?? false } }));
  }
  app.use(
    cors({
      origin: env.FRONTEND_URL, // only the trusted frontend origin(s)
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Accept', 'X-CSRF-Token', 'X-Requested-With'],
      optionsSuccessStatus: 204,
      maxAge: 600,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(rejectOperatorInjection);

  const v1 = Router();

  // Public: liveness + database connectivity.
  v1.get('/health', (_req, res) => {
    const dbUp = isDatabaseConnected();
    res.status(dbUp ? 200 : 503).json({
      success: dbUp,
      message: dbUp ? 'Service healthy' : 'Database unavailable',
      data: { status: dbUp ? 'ok' : 'degraded', database: dbUp ? 'up' : 'down', uptimeSeconds: Math.round(process.uptime()) },
    });
  });

  if (rateLimit) v1.use(apiLimiter);
  v1.use(csrfProtection({ exempt: ['/auth/login'], originOnly: ['/auth/refresh', '/auth/logout'] }));

  v1.use('/auth', createAuthRouter({ rateLimit }));

  // Every business route requires an authenticated administrator.
  const protectedRoute = [authenticate, requireRole('admin')];
  v1.use('/doctors', ...protectedRoute, doctorRouter);
  v1.use('/patients', ...protectedRoute, patientRouter);
  v1.use('/dashboard', ...protectedRoute, dashboardRouter);

  app.use('/api/v1', v1);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}