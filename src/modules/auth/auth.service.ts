import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import type { Types } from 'mongoose';
import { unauthorized } from '../../utils/errors.js';
import { Admin } from './admin.model.js';
import {
  refreshTtlMs,
  shortRefreshTtlMs,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from './tokens.js';

const BCRYPT_ROUNDS = 12;
const MAX_SESSIONS_PER_ADMIN = 10;

// Compared against when the email is unknown so response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('timing-equalisation-placeholder', BCRYPT_ROUNDS);

export interface AdminProfile {
  id: string;
  email: string;
  role: string;
  createdAt: Date;
}

export interface IssuedSession {
  admin: AdminProfile;
  accessToken: string;
  refreshToken: string;
  refreshTtlMs: number;
  remember: boolean;
}

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, BCRYPT_ROUNDS);

function toProfile(admin: { _id: Types.ObjectId; email: string; role: string; createdAt: Date }): AdminProfile {
  return { id: String(admin._id), email: admin.email, role: admin.role, createdAt: admin.createdAt };
}

async function startSession(
  admin: { _id: Types.ObjectId; email: string; role: string; createdAt: Date },
  options: { family: string; remember: boolean; userAgent?: string },
): Promise<IssuedSession> {
  const jti = crypto.randomUUID();
  const ttl = options.remember ? refreshTtlMs : shortRefreshTtlMs;
  const adminId = String(admin._id);

  // Drop sessions that have already expired, then register the new one (bounded per admin).
  await Admin.updateOne({ _id: admin._id }, { $pull: { sessions: { expiresAt: { $lt: new Date() } } } });
  await Admin.updateOne(
    { _id: admin._id },
    {
      $push: {
        sessions: {
          $each: [
            {
              jti,
              family: options.family,
              remember: options.remember,
              expiresAt: new Date(Date.now() + ttl),
              createdAt: new Date(),
              userAgent: options.userAgent?.slice(0, 256),
            },
          ],
          $slice: -MAX_SESSIONS_PER_ADMIN,
        },
      },
    },
  );

  return {
    admin: toProfile(admin),
    accessToken: signAccessToken(adminId, admin.role),
    refreshToken: signRefreshToken(adminId, jti, options.family, ttl),
    refreshTtlMs: ttl,
    remember: options.remember,
  };
}

export async function login(
  email: string,
  password: string,
  rememberMe: boolean,
  userAgent?: string,
): Promise<IssuedSession> {
  const admin = await Admin.findOne({ email }).select('+password').lean();
  const passwordMatches = await bcrypt.compare(password, admin?.password ?? DUMMY_HASH);
  if (!admin || !passwordMatches) {
    throw unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }
  return startSession(admin, { family: crypto.randomUUID(), remember: rememberMe, userAgent });
}

/**
 * Rotates a refresh token. The old token is removed with one atomic
 * findOneAndUpdate, so of two concurrent requests presenting the same token only
 * one can win. A token that is validly signed but no longer registered has already
 * been used: that is treated as theft and the whole token family is revoked.
 */
export async function refresh(refreshToken: string, userAgent?: string): Promise<IssuedSession> {
  const payload = verifyRefreshToken(refreshToken); // throws on bad signature / expiry

  const before = await Admin.findOneAndUpdate(
    { _id: payload.sub, 'sessions.jti': payload.jti },
    { $pull: { sessions: { jti: payload.jti } } },
    { returnDocument: 'before', projection: { email: 1, role: 1, createdAt: 1, sessions: 1 } },
  )
    .select('+sessions')
    .lean();

  if (!before) {
    await Admin.updateOne({ _id: payload.sub }, { $pull: { sessions: { family: payload.fam } } });
    throw unauthorized('Session is no longer valid. Please sign in again.', 'SESSION_REVOKED');
  }

  const session = before.sessions?.find((item) => item.jti === payload.jti);
  if (!session || session.expiresAt.getTime() < Date.now()) {
    throw unauthorized('Session has expired. Please sign in again.', 'SESSION_EXPIRED');
  }

  return startSession(before, { family: session.family, remember: session.remember, userAgent });
}

/** Revokes the whole login (token family) the refresh token belongs to. Never throws for bad tokens. */
export async function logout(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;
  try {
    const payload = verifyRefreshToken(refreshToken);
    await Admin.updateOne({ _id: payload.sub }, { $pull: { sessions: { family: payload.fam } } });
  } catch {
    // An invalid or expired token has nothing left to revoke.
  }
}

export async function getProfile(adminId: string): Promise<AdminProfile> {
  const admin = await Admin.findById(adminId).lean();
  if (!admin) throw unauthorized('Account no longer exists', 'ACCOUNT_NOT_FOUND');
  return toProfile(admin);
}
