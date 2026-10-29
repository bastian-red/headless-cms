/**
 * The publisher's health report, as a pure function of its probes.
 *
 * Each probe is a real operation (a `SELECT 1`, a `PING`), timed, and turned
 * into a check that names its failure. The report is `degraded` when any check
 * fails, and the HTTP layer answers 503 for that, so a container runtime that
 * cannot read JSON still sees the outage.
 */
import type { Health, HealthCheck } from '@cms/shared';

export type Probe = () => Promise<void>;

export async function timed(name: string, probe: Probe): Promise<HealthCheck> {
  const started = Date.now();
  try {
    await probe();
    return { name, status: 'ok', latencyMs: Date.now() - started, detail: null };
  } catch (error) {
    return {
      name,
      status: 'fail',
      latencyMs: Date.now() - started,
      // The message, never a stack: this body is public through /status.
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function report(
  probes: Readonly<Record<string, Probe>>,
  meta: { version: string; startedAt: number; now?: number },
): Promise<Health> {
  const checks = await Promise.all(Object.entries(probes).map(([name, p]) => timed(name, p)));
  return {
    status: checks.every((check) => check.status === 'ok') ? 'ok' : 'degraded',
    service: 'publisher',
    version: meta.version,
    uptimeSeconds: Math.max(0, Math.floor(((meta.now ?? Date.now()) - meta.startedAt) / 1000)),
    checks,
  };
}

/** The status code a report answers with. */
export function httpStatusFor(health: Health): 200 | 503 {
  return health.status === 'ok' ? 200 : 503;
}
