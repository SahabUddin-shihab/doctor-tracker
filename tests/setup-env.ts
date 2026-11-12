// Runs before any test file imports application code, so config/env.ts sees these values.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/unused-placeholder';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789-0123456789-abcdef';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789-0123456789-abcdef';
process.env.COOKIE_SECRET = 'test-cookie-secret-0123456789-0123456789-abcdefg';
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.ACCESS_TOKEN_EXPIRES_IN = '15m';
process.env.REFRESH_TOKEN_EXPIRES_IN = '7d';
// A non-UTC zone so every date test exercises the timezone logic for real.
process.env.APP_TIMEZONE = 'Asia/Dhaka';
process.env.LOG_LEVEL = 'silent';
