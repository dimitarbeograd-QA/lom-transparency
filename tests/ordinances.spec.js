'use strict';

const { test, expect } = require('@playwright/test');
const { adminLogin } = require('./helpers');

test.describe('public ordinances list', () => {
  test('only shows approved ordinances, supports status/category filters, and renders a NULL adoption_date without error', async ({
    page,
    browser,
  }) => {
    await adminLogin(page);

    // Seed one pending + one approved (with NO adoption_date, the common
    // real-world case for freshly-scraped ordinances) via the admin API.
    const pending = await page.request.post('/api/ordinances', {
      data: { title: 'E2E чакаща наредба' },
    });
    expect(pending.ok()).toBeTruthy();
    const pendingBody = await pending.json();

    const approved = await page.request.post('/api/ordinances', {
      data: {
        title: 'E2E одобрена наредба без дата',
        category: 'Данъци',
        status: 'active',
      },
    });
    expect(approved.ok()).toBeTruthy();
    const approvedBody = await approved.json();
    expect(approvedBody.ordinance.adoption_date).toBeNull();

    const approveRes = await page.request.post(
      `/api/review/ordinances/${approvedBody.ordinance.id}/approve`
    );
    expect(approveRes.ok()).toBeTruthy();

    // Check the PUBLIC contract from a genuinely unauthenticated browser
    // context (no admin cookie), not the already-logged-in `page`.
    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();

    await anonPage.goto('/ordinances/');
    await expect(anonPage.getByText('E2E одобрена наредба без дата')).toBeVisible();
    await expect(anonPage.getByText('E2E чакаща наредба')).not.toBeVisible();
    // NULL adoption_date must render gracefully, not blank/broken.
    await expect(anonPage.getByText('неизвестна')).toBeVisible();

    // status filter
    await anonPage.goto('/ordinances/?status=active');
    await expect(anonPage.getByText('E2E одобрена наредба без дата')).toBeVisible();
    await anonPage.goto('/ordinances/?status=repealed');
    await expect(anonPage.getByText('E2E одобрена наредба без дата')).not.toBeVisible();

    // category filter
    await anonPage.goto('/ordinances/?category=%D0%94%D0%B0%D0%BD%D1%8A%D1%86%D0%B8'); // "Данъци"
    await expect(anonPage.getByText('E2E одобрена наредба без дата')).toBeVisible();

    await anonContext.close();
  });
});

test.describe('admin ordinances workflow', () => {
  test('admin can create and approve an ordinance, fill in a date, and it appears on the public page', async ({
    page,
    browser,
  }) => {
    await adminLogin(page);
    await page.goto('/admin/ordinances.html');

    await page.click('#new-ordinance-btn');
    await page.fill('#ordinance-title', 'E2E административна наредба');
    await page.fill('#ordinance-category', 'Устройство на територията');
    await page.fill('#ordinance-adoption-date', '2020-05-15');
    await page.click('#ordinance-form-submit');

    // New records default to the "pending" tab, which is the default view.
    await expect(page.getByText('E2E административна наредба')).toBeVisible();

    // Approve it from the table.
    const row = page.locator('tr', { hasText: 'E2E административна наредба' });
    await row.getByRole('button', { name: 'Одобри' }).click();

    // After approval it should disappear from the "pending" tab...
    await expect(page.getByText('E2E административна наредба')).not.toBeVisible();

    // ...and show up under "Одобрени".
    await page.click('button[data-status="approved"]');
    await expect(page.getByText('E2E административна наредба')).toBeVisible();

    // Verify it reaches the real public page too, from a fresh
    // unauthenticated context, with the filled-in adoption date shown.
    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();
    await anonPage.goto('/ordinances/');
    await expect(anonPage.getByText('E2E административна наредба')).toBeVisible();
    await anonContext.close();
  });
});

test.describe('ordinances API auth pen test', () => {
  test('POST/PUT/DELETE /api/ordinances with no session cookie all return 401', async ({ page }) => {
    // Fresh page/context -- no admin cookie has been set anywhere in this test.
    const postRes = await page.request.post('/api/ordinances', {
      data: { title: 'Опит без сесия' },
    });
    expect(postRes.status()).toBe(401);

    const putRes = await page.request.put('/api/ordinances/1', {
      data: { title: 'Опит без сесия' },
    });
    expect(putRes.status()).toBe(401);

    const deleteRes = await page.request.delete('/api/ordinances/1');
    expect(deleteRes.status()).toBe(401);
  });
});
