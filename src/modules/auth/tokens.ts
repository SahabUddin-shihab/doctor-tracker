import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { durationToMs } from '../../utils/duration.js';

const ISSUER = 'doctor-tracker';
const ACCESS_AUDIENCE = 'doctor-tracker:access';
const REFRESH_AUDIENCE = 'doctor-tracker:refresh';
const ALGORITHM = 'HS256' as const;

export interface AccessPayload {
  sub: string;
  role: string;
}

export interface RefreshPayload {
  sub: string;
  jti: string;
  fam: string;
}

export const accessTtlMs = durationToMs(env.ACCESS_TOKEN_EXPIRES_IN);
export const refreshTtlMs = durationToMs(env.REFRESH_TOKEN_EXPIRES_IN);
/** Refresh lifetime when "remember me" is not ticked: a one-day session cookie. */
export const shortRefreshTtlMs = Math.min(refreshTtlMs, durationToMs('1d'));

export function signAccessToken(adminId: string, role: string): string {
  return jwt.sign({ role }, env.JWT_ACCESS_SECRET, {
    algorithm: ALGORITHM,
    subject: adminId,
    issuer: ISSUER,
    audience: ACCESS_AUDIENCE,
    expiresIn: Math.floor(accessTtlMs / 1000),
  });
}

export function signRefreshToken(adminId: string, jti: string, family: string, ttlMs: number): string {
  return jwt.sign({ fam: family }, env.JWT_REFRESH_SECRET, {
    algorithm: ALGORITHM,
    subject: adminId,
    issuer: ISSUER,
    audience: REFRESH_AUDIENCE,
    jwtid: jti,
    expiresIn: Math.floor(ttlMs / 1000),
  });
}

export function verifyAccessToken(token: string): AccessPayload {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: [ALGORITHM],
    issuer: ISSUER,
    audience: ACCESS_AUDIENCE,
  });
  if (typeof payload === 'string' || !payload.sub || typeof payload.role !== 'string') {
    throw new jwt.JsonWebTokenError('Malformed access token');
  }
  return { sub: payload.sub, role: payload.role };
}

export function verifyRefreshToken(token: string): RefreshPayload {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET, {
    algorithms: [ALGORITHM],
    issuer: ISSUER,
    audience: REFRESH_AUDIENCE,
  });
  if (typeof payload === 'string' || !payload.sub || !payload.jti || typeof payload.fam !== 'string') {
    throw new jwt.JsonWebTokenError('Malformed refresh token');
  }
  return { sub: payload.sub, jti: payload.jti, fam: payload.fam };
}
