import { isTest } from '../../config/env.js';

/**
 * Tiny in-process TTL cache for dashboard aggregations.
 *
 * Why: the dashboard fires five aggregation endpoints on every page view and the
 * underlying numbers only change when an administrator mutates a doctor/patient.
 * Every mutation calls `invalidateDashboardCache()`, so the 30s TTL is only a
 * safety net, not the freshness mechanism. Limitation: the cache is per process;
 * with several API instances you would use a shared cache (e.g. Redis) instead.
 * It is disabled under test so assertions always see live data.
 */
const TTL_MS = 30_000;
const MAX_ENTRIES = 200;

interface Entry {
  expires: number;
  value: unknown;
}
const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

export function invalidateDashboardCache(): void {
  store.clear();
  inflight.clear();
}

export async function cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
  if (isTest) return compute();

  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;

  // Coalesce concurrent identical requests into one database round-trip.
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = compute()
    .then((value) => {
      if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value as string);
      store.set(key, { value, expires: Date.now() + TTL_MS });
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}
