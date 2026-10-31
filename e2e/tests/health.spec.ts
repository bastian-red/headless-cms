import { API_BASE_URL, expect, PUBLISHER_URL, test } from '../fixtures';

test.describe('every service answers /health with its dependencies checked', () => {
  // The publisher has no Redis: schedules and the outbox live in Postgres, and
  // its other two checks fail when either one stops moving.
  for (const [name, base, checks] of [
    ['api', API_BASE_URL, ['postgres:ok', 'redis:ok']],
    ['publisher', PUBLISHER_URL, ['outbox:ok', 'postgres:ok', 'schedule:ok']],
  ] as const) {
    test(name, async ({ request }) => {
      const response = await request.get(`${base}/health`);
      expect(response.status()).toBe(200);
      const body = (await response.json()) as {
        service: string;
        status: string;
        checks: { name: string; status: string }[];
      };
      expect(body.service).toBe(name);
      expect(body.checks.map((c) => `${c.name}:${c.status}`).sort()).toEqual(checks);
    });
  }
});

test('the /status page shows both services up, each with its checks', async ({ page }) => {
  await page.goto('/status');
  await expect(page.getByTestId('overall')).toHaveText(/Every service is up/u);
  for (const [service, checks] of [
    ['api', ['postgres', 'redis']],
    ['publisher', ['postgres', 'outbox', 'schedule']],
  ] as const) {
    const card = page.locator(`[data-service="${service}"]`);
    await expect(card).toContainText('Up');
    for (const check of checks) await expect(card).toContainText(check);
  }
});
