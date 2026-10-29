import { API_BASE_URL, expect, PUBLISHER_URL, test } from '../fixtures';

test.describe('every service answers /health with its dependencies checked', () => {
  for (const [name, base] of [
    ['api', API_BASE_URL],
    ['publisher', PUBLISHER_URL],
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
      expect(body.checks.map((c) => `${c.name}:${c.status}`).sort()).toEqual([
        'postgres:ok',
        'redis:ok',
      ]);
    });
  }
});

test('the /status page shows both services up, each with its checks', async ({ page }) => {
  await page.goto('/status');
  await expect(page.getByTestId('overall')).toHaveText(/Every service is up/u);
  for (const service of ['api', 'publisher']) {
    const card = page.locator(`[data-service="${service}"]`);
    await expect(card).toContainText('Up');
    await expect(card).toContainText('postgres');
    await expect(card).toContainText('redis');
  }
});
