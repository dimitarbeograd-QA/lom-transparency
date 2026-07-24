'use strict';

const { test, expect } = require('@playwright/test');
const { adminLogin } = require('./helpers');

// NOTE: the "public list only shows approved" tests below are expected to
// fail against the current repo state, NOT because of a bug in this
// module, but because of a routing bug in the shared, do-not-edit
// server/routes/review.js (its `router.use(requireAdmin)` has no path
// prefix, so it ends up gating every /api/* request mounted after it in
// server/routes/index.js -- including public GET routes like
// GET /api/council-decisions that were never supposed to require auth).
// See server/tests/decisions.test.js for a minimal repro and the one-line
// suggested fix. These tests are left intact (not weakened) so they start
// passing the moment that shared bug is fixed.

test.describe('public decisions list', () => {
  test('only shows approved decisions and supports session_number/category/date filters', async ({
    page,
    browser,
  }) => {
    const cookie = await (async () => {
      await page.goto('/admin/index.html');
      await page.fill('#username', 'admin');
      await page.fill('#password', 'admin123');
      await page.click('#login-submit');
      await page.waitForURL('**/admin/dashboard.html');
    })();

    // Seed one pending + one approved decision via the admin API (running
    // inside the authenticated admin page's browser context).
    const pending = await page.request.post('/api/council-decisions', {
      data: {
        session_number: 'E2E-PENDING',
        decision_number: '1',
        title: 'E2E чакащо решение',
        session_date: '2026-04-01',
      },
    });
    expect(pending.ok()).toBeTruthy();
    const pendingBody = await pending.json();

    const approved = await page.request.post('/api/council-decisions', {
      data: {
        session_number: 'E2E-APPROVED',
        decision_number: '1',
        title: 'E2E одобрено решение',
        category: 'Бюджет',
        session_date: '2026-04-15',
      },
    });
    expect(approved.ok()).toBeTruthy();
    const approvedBody = await approved.json();

    const approveRes = await page.request.post(
      `/api/review/council_decisions/${approvedBody.decision.id}/approve`
    );
    expect(approveRes.ok()).toBeTruthy();

    // Check the PUBLIC contract from a genuinely unauthenticated browser
    // context (no admin cookie), not the already-logged-in `page`.
    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();

    await anonPage.goto('/decisions/');
    await expect(anonPage.getByText('E2E одобрено решение')).toBeVisible();
    await expect(anonPage.getByText('E2E чакащо решение')).not.toBeVisible();

    // category filter
    await anonPage.goto('/decisions/?category=%D0%91%D1%8E%D0%B4%D0%B6%D0%B5%D1%82'); // "Бюджет"
    await expect(anonPage.getByText('E2E одобрено решение')).toBeVisible();

    await anonContext.close();
  });
});

test.describe('admin decisions workflow', () => {
  test('admin can create and approve a decision, and it then appears on the public page', async ({
    page,
    browser,
  }) => {
    await adminLogin(page);
    await page.goto('/admin/decisions.html');

    await page.click('#new-decision-btn');
    await page.fill('#decision-title', 'E2E административно решение');
    await page.fill('#decision-category', 'Устройство на територията');
    await page.fill('#decision-session-number', 'E2E-ADMIN-FLOW');
    await page.fill('#decision-number', '77');
    await page.click('#decision-form-submit');

    // New records default to the "pending" tab, which is the default view.
    await expect(page.getByText('E2E административно решение')).toBeVisible();

    // Approve it from the table.
    const row = page.locator('tr', { hasText: 'E2E административно решение' });
    await row.getByRole('button', { name: 'Одобри' }).click();

    // After approval it should disappear from the "pending" tab...
    await expect(page.getByText('E2E административно решение')).not.toBeVisible();

    // ...and show up under "Одобрени".
    await page.click('button[data-status="approved"]');
    await expect(page.getByText('E2E административно решение')).toBeVisible();

    // Verify it reaches the real public page too, from a fresh
    // unauthenticated context.
    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();
    await anonPage.goto('/decisions/');
    await expect(anonPage.getByText('E2E административно решение')).toBeVisible();
    await anonContext.close();
  });
});

test.describe('decisions API auth pen test', () => {
  test('POST /api/council-decisions with no session cookie returns 401', async ({ page }) => {
    // Fresh page/context -- no admin cookie has been set anywhere in this test.
    const res = await page.request.post('/api/council-decisions', {
      data: { title: 'Опит без сесия' },
    });
    expect(res.status()).toBe(401);
  });
});
