'use strict';

const { test, expect } = require('@playwright/test');
const { adminLogin } = require('./helpers');

test.describe('public procurement list', () => {
  test('only shows approved procurements and supports status/procedure_type/year filters', async ({
    page,
    browser,
  }) => {
    await adminLogin(page);

    // Seed one pending + one approved procurement via the admin API (running
    // inside the authenticated admin page's browser context).
    const pending = await page.request.post('/api/procurements', {
      data: {
        title: 'E2E чакаща поръчка',
        publish_date: '2026-04-01',
      },
    });
    expect(pending.ok()).toBeTruthy();
    const pendingBody = await pending.json();

    const approved = await page.request.post('/api/procurements', {
      data: {
        title: 'E2E одобрена поръчка',
        procedure_type: 'Публично състезание',
        status: 'обявена',
        publish_date: '2026-04-15',
      },
    });
    expect(approved.ok()).toBeTruthy();
    const approvedBody = await approved.json();

    const approveRes = await page.request.post(
      `/api/review/procurements/${approvedBody.procurement.id}/approve`
    );
    expect(approveRes.ok()).toBeTruthy();

    // Check the PUBLIC contract from a genuinely unauthenticated browser
    // context (no admin cookie), not the already-logged-in `page`.
    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();

    await anonPage.goto('/procurement/');
    await expect(anonPage.getByText('E2E одобрена поръчка')).toBeVisible();
    await expect(anonPage.getByText('E2E чакаща поръчка')).not.toBeVisible();

    // procedure_type filter
    await anonPage.goto(
      '/procurement/?procedure_type=' + encodeURIComponent('Публично състезание')
    );
    await expect(anonPage.getByText('E2E одобрена поръчка')).toBeVisible();

    // year filter that should exclude the seeded record
    await anonPage.goto('/procurement/?year=2020');
    await expect(anonPage.getByText('E2E одобрена поръчка')).not.toBeVisible();

    await anonContext.close();
  });
});

test.describe('admin procurement workflow', () => {
  test('admin can create and approve a procurement, and it then appears on the public page', async ({
    page,
    browser,
  }) => {
    await adminLogin(page);
    await page.goto('/admin/procurement.html');

    await page.click('#new-procurement-btn');
    await page.fill('#procurement-title', 'E2E административна поръчка');
    await page.fill('#procurement-procedure-type', 'Открита процедура');
    await page.fill('#procurement-estimated-value', '15000');
    await page.click('#procurement-form-submit');

    // New records default to the "pending" tab, which is the default view.
    await expect(page.getByText('E2E административна поръчка')).toBeVisible();

    // Approve it from the table.
    const row = page.locator('tr', { hasText: 'E2E административна поръчка' });
    await row.getByRole('button', { name: 'Одобри' }).click();

    // After approval it should disappear from the "pending" tab...
    await expect(page.getByText('E2E административна поръчка')).not.toBeVisible();

    // ...and show up under "Одобрени".
    await page.click('button[data-status="approved"]');
    await expect(page.getByText('E2E административна поръчка')).toBeVisible();

    // Verify it reaches the real public page too, from a fresh
    // unauthenticated context.
    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();
    await anonPage.goto('/procurement/');
    await expect(anonPage.getByText('E2E административна поръчка')).toBeVisible();
    await anonContext.close();
  });
});

test.describe('procurement API auth pen test', () => {
  test('POST /api/procurements with no session cookie returns 401', async ({ page }) => {
    // Fresh page/context -- no admin cookie has been set anywhere in this test.
    const res = await page.request.post('/api/procurements', {
      data: { title: 'Опит без сесия' },
    });
    expect(res.status()).toBe(401);
  });
});
