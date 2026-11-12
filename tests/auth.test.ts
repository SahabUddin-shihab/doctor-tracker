import supertest from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Admin } from '../src/modules/auth/admin.model.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  app,
  createTestAdmin,
  loginClient,
  signExpiredAccessToken,
  useTestDatabase,
} from './helpers.js';

useTestDatabase();

const api = '/api/v1';

function cookieNames(res: supertest.Response): string[] {
  return ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []).map((c) => c.split('=')[0] as string);
}
function findCookie(res: supertest.Response, name: string): string {
  const cookies = (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  return cookies.find((c) => c.startsWith(`${name}=`)) ?? '';
}

describe('POST /auth/login', () => {
  it('signs in with valid credentials and sets HttpOnly cookies', async () => {
    await createTestAdmin();
    const res = await supertest(app).post(`${api}/auth/login`).send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.admin.email).toBe(ADMIN_EMAIL);
    expect(typeof res.body.data.csrfToken).toBe('string');

    for (const name of ['access_token', 'refresh_token', 'csrf_token']) {
      expect(findCookie(res, name), `${name} cookie`).toMatch(/HttpOnly/i);
    }
    expect(findCookie(res, 'refresh_token')).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('never exposes the password hash or tokens in the response body', async () => {
    await createTestAdmin();
    const res = await supertest(app).post(`${api}/auth/login`).send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/\$2[aby]\$/); // bcrypt hash prefix
    expect(body).not.toMatch(/password"/);
    expect(body).not.toMatch(/sessions/);
    expect(body).not.toMatch(/eyJ/); // JWTs only travel in cookies
  });

  it('stores only a bcrypt hash, never the plaintext password', async () => {
    await createTestAdmin();
    const stored = await Admin.findOne({ email: ADMIN_EMAIL }).select('+password').lean();
    expect(stored?.password).not.toBe(ADMIN_PASSWORD);
    expect(stored?.password).toMatch(/^\$2[aby]\$12\$/);
  });

  it('rejects a wrong password and an unknown email with the same generic error', async () => {
    await createTestAdmin();
    const wrongPassword = await supertest(app).post(`${api}/auth/login`).send({ email: ADMIN_EMAIL, password: 'nope-nope-nope' });
    const unknownEmail = await supertest(app).post(`${api}/auth/login`).send({ email: 'ghost@test.example', password: 'nope-nope-nope' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
    expect(cookieNames(wrongPassword)).toHaveLength(0);
  });

  it('validates the payload', async () => {
    const res = await supertest(app).post(`${api}/auth/login`).send({ email: 'not-an-email', password: '' });
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e: { path: string }) => e.path).sort()).toEqual(['email', 'password']);
  });

  it('rejects NoSQL operator injection', async () => {
    await createTestAdmin();
    const res = await supertest(app).post(`${api}/auth/login`).send({ email: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(400);
    expect(cookieNames(res)).toHaveLength(0);
  });

  it('uses a session cookie for the refresh token unless "remember me" is chosen', async () => {
    await createTestAdmin();
    const session = await supertest(app).post(`${api}/auth/login`).send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, rememberMe: false });
    const remembered = await supertest(app).post(`${api}/auth/login`).send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, rememberMe: true });

    expect(findCookie(session, 'refresh_token')).not.toMatch(/Max-Age|Expires/i);
    expect(findCookie(remembered, 'refresh_token')).toMatch(/Max-Age=604800/);
  });

  it('is rate limited after repeated failures', async () => {
    await createTestAdmin();
    const limited = supertest(createApp({ rateLimit: true }));
    let last = 0;
    for (let i = 0; i < 11; i += 1) {
      last = (await limited.post(`${api}/auth/login`).send({ email: ADMIN_EMAIL, password: 'wrong-wrong-wrong' })).status;
    }
    expect(last).toBe(429);
  });

  it('has no public administrator registration endpoint', async () => {
    for (const path of ['/auth/register', '/auth/signup', '/admins']) {
      const res = await supertest(app).post(`${api}${path}`).send({ email: 'x@test.example', password: ADMIN_PASSWORD });
      // Blocked by the CSRF guard (403) or unrouted (404); never a success.
      expect([403, 404], path).toContain(res.status);
    }
    expect(await Admin.countDocuments({ email: 'x@test.example' })).toBe(0);
  });
});

describe('route protection', () => {
  const protectedRoutes = [
    ['get', '/doctors'],
    ['get', '/doctors/options'],
    ['get', '/patients'],
    ['get', '/dashboard/overview'],
    ['get', '/dashboard/trends'],
    ['get', '/auth/me'],
  ] as const;

  it.each(protectedRoutes)('%s %s requires authentication', async (method, path) => {
    const res = await supertest(app)[method](`${api}${path}`);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects a forged / garbage token', async () => {
    const res = await supertest(app).get(`${api}/doctors`).set('Cookie', 'access_token=not.a.jwt');
    expect(res.status).toBe(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const forged = jwt.sign({ role: 'admin' }, 'x'.repeat(40), { subject: 'a'.repeat(24), issuer: 'doctor-tracker', audience: 'doctor-tracker:access' });
    const res = await supertest(app).get(`${api}/doctors`).set('Cookie', `access_token=${forged}`);
    expect(res.status).toBe(401);
  });

  it('rejects an expired access token with TOKEN_EXPIRED', async () => {
    await createTestAdmin();
    const admin = await Admin.findOne({ email: ADMIN_EMAIL }).lean();
    const res = await supertest(app)
      .get(`${api}/doctors`)
      .set('Cookie', `access_token=${signExpiredAccessToken(String(admin?._id))}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_EXPIRED');
  });

  it('does not accept a refresh token as an access token', async () => {
    await createTestAdmin();
    const login = await supertest(app).post(`${api}/auth/login`).send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const refresh = /refresh_token=([^;]+)/.exec(findCookie(login, 'refresh_token'))?.[1];
    const res = await supertest(app).get(`${api}/doctors`).set('Cookie', `access_token=${refresh}`);
    expect(res.status).toBe(401);
  });

  it('GET /auth/me returns the signed-in administrator', async () => {
    const client = await loginClient();
    const res = await client.get(`${api}/auth/me`);
    expect(res.status).toBe(200);
    expect(res.body.data.admin.email).toBe(ADMIN_EMAIL);
    expect(res.body.data.admin).not.toHaveProperty('password');
  });
});

describe('CSRF protection', () => {
  it('blocks state-changing requests that lack the CSRF header', async () => {
    const client = await loginClient();
    const res = await client.agent.post(`${api}/doctors`).send({});
    expect(res.status).toBe(403);
  });

  it('blocks requests with a wrong CSRF token', async () => {
    const client = await loginClient();
    const res = await client.agent.post(`${api}/doctors`).set('X-CSRF-Token', 'forged.token').send({});
    expect(res.status).toBe(403);
  });

  it('blocks requests from an untrusted origin even with a valid token', async () => {
    const client = await loginClient();
    const res = await client.post(`${api}/doctors`).set('Origin', 'https://evil.example').send({});
    expect(res.status).toBe(403);
  });

  it('allows safe (GET) requests without the header', async () => {
    const client = await loginClient();
    expect((await client.agent.get(`${api}/doctors`)).status).toBe(200);
  });
});

describe('CORS and headers', () => {
  it('only allows the trusted frontend origin', async () => {
    const trusted = await supertest(app).options(`${api}/doctors`).set('Origin', 'http://localhost:3000').set('Access-Control-Request-Method', 'GET');
    const untrusted = await supertest(app).options(`${api}/doctors`).set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
    expect(trusted.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(trusted.headers['access-control-allow-credentials']).toBe('true');
    expect(untrusted.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sends Helmet security headers and hides the framework', async () => {
    const res = await supertest(app).get(`${api}/health`);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('refresh-token rotation', () => {
  async function login() {
    await createTestAdmin();
    const res = await supertest(app).post(`${api}/auth/login`).send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, rememberMe: true });
    const cookie = (name: string) => `${name}=${/=([^;]+)/.exec(findCookie(res, name))?.[1]}`;
    return { csrf: res.body.data.csrfToken as string, refresh: cookie('refresh_token'), csrfCookie: cookie('csrf_token') };
  }

  it('issues a fresh token pair and invalidates the old refresh token', async () => {
    const first = await login();
    const rotated = await supertest(app).post(`${api}/auth/refresh`).set('Cookie', [first.refresh, first.csrfCookie]).set('X-CSRF-Token', first.csrf);

    expect(rotated.status).toBe(200);
    expect(cookieNames(rotated)).toEqual(expect.arrayContaining(['access_token', 'refresh_token', 'csrf_token']));
    expect(findCookie(rotated, 'refresh_token')).not.toContain(first.refresh);
  });

  it('treats re-use of a rotated token as theft and revokes the whole token family', async () => {
    const first = await login();
    const headers = { Cookie: [first.refresh, first.csrfCookie] };

    const rotated = await supertest(app).post(`${api}/auth/refresh`).set(headers).set('X-CSRF-Token', first.csrf);
    expect(rotated.status).toBe(200);
    const newRefresh = `refresh_token=${/=([^;]+)/.exec(findCookie(rotated, 'refresh_token'))?.[1]}`;

    // The attacker replays the OLD token: rejected, and the family is burned...
    const replay = await supertest(app).post(`${api}/auth/refresh`).set(headers).set('X-CSRF-Token', first.csrf);
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('SESSION_REVOKED');

    // ...so even the legitimate newest token no longer works.
    const legit = await supertest(app).post(`${api}/auth/refresh`).set('Cookie', [newRefresh, first.csrfCookie]).set('X-CSRF-Token', first.csrf);
    expect(legit.status).toBe(401);
  });

  it('recovers a session after a page reload (refresh works without the in-memory CSRF header)', async () => {
    // Regression: after a reload the SPA has no CSRF token in memory, yet it must be able to refresh.
    const first = await login();
    const res = await supertest(app).post(`${api}/auth/refresh`).set('Cookie', [first.refresh]);
    expect(res.status).toBe(200);
    expect(res.body.data.csrfToken).toEqual(expect.any(String));
  });

  it('still refuses refresh/logout requests that come from an untrusted origin', async () => {
    const first = await login();
    const refresh = await supertest(app).post(`${api}/auth/refresh`).set('Cookie', [first.refresh]).set('Origin', 'https://evil.example');
    const logout = await supertest(app).post(`${api}/auth/logout`).set('Cookie', [first.refresh]).set('Origin', 'https://evil.example');
    expect(refresh.status).toBe(403);
    expect(logout.status).toBe(403);
    // ...and the token was not consumed by the rejected attempt.
    expect((await supertest(app).post(`${api}/auth/refresh`).set('Cookie', [first.refresh]).set('Origin', 'http://localhost:3000')).status).toBe(200);
  });

  it('answers 401 (not 403) when there is no refresh cookie at all', async () => {
    const res = await supertest(app).post(`${api}/auth/refresh`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('NO_REFRESH_TOKEN');
  });

  it('rejects refresh without a refresh cookie', async () => {
    const client = await loginClient();
    const res = await supertest(app).post(`${api}/auth/refresh`).set('Cookie', [`csrf_token=${client.csrf}`]).set('X-CSRF-Token', client.csrf);
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('clears all auth cookies and revokes the refresh token', async () => {
    await createTestAdmin();
    const login = await supertest(app).post(`${api}/auth/login`).send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, rememberMe: true });
    const cookie = (name: string) => `${name}=${/=([^;]+)/.exec(findCookie(login, name))?.[1]}`;
    const csrf = login.body.data.csrfToken as string;
    const jar = [cookie('access_token'), cookie('refresh_token'), cookie('csrf_token')];

    const out = await supertest(app).post(`${api}/auth/logout`).set('Cookie', jar).set('X-CSRF-Token', csrf);
    expect(out.status).toBe(200);
    for (const name of ['access_token', 'refresh_token', 'csrf_token']) {
      expect(findCookie(out, name), name).toMatch(/Expires=Thu, 01 Jan 1970/);
    }

    // The old refresh token can no longer mint new sessions.
    const after = await supertest(app).post(`${api}/auth/refresh`).set('Cookie', jar).set('X-CSRF-Token', csrf);
    expect(after.status).toBe(401);
  });

  it('still succeeds (and clears cookies) when no session exists', async () => {
    const client = await loginClient();
    const res = await supertest(app).post(`${api}/auth/logout`).set('Cookie', [`csrf_token=${client.csrf}`]).set('X-CSRF-Token', client.csrf);
    expect(res.status).toBe(200);
  });
});

describe('GET /health', () => {
  it('reports database connectivity without authentication', async () => {
    const res = await supertest(app).get(`${api}/health`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'ok', database: 'up' });
  });
});

describe('error responses', () => {
  it('uses the standard error shape for unknown routes and malformed JSON', async () => {
    const missing = await supertest(app).get(`${api}/nope`);
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ success: false, errors: [] });

    const malformed = await supertest(app).post(`${api}/auth/login`).set('Content-Type', 'application/json').send('{bad json');
    expect(malformed.status).toBe(400);
    expect(malformed.body.success).toBe(false);
  });
});
