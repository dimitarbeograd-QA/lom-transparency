'use strict';

const path = require('path');
const { test, expect } = require('@playwright/test');
const { adminLogin } = require('./helpers');

// better-sqlite3 lives in server/node_modules (this test file is a sibling
// of server/, not a descendant, so plain `require('better-sqlite3')` would
// not resolve it -- we point straight at the installed copy instead of
// adding a root dependency, since package.json is a shared file we must not
// edit).
const Database = require(path.join(__dirname, '..', 'server', 'node_modules', 'better-sqlite3'));

const TEST_DB_PATH = path.join(__dirname, '..', 'server', 'lom.test.db');

function seedPendingProject(name) {
  const db = new Database(TEST_DB_PATH);
  try {
    const info = db
      .prepare(`INSERT INTO projects (name, category, status, review_status) VALUES (?, 'Тест E2E', 'active', 'pending')`)
      .run(name);
    return info.lastInsertRowid;
  } finally {
    db.close();
  }
}

test.describe('budget module', () => {
  test('public budget page renders only approved projects, not pending ones', async ({ page }) => {
    const uniqueSuffix = Date.now();
    const pendingName = `Чакащ Е2Е проект ${uniqueSuffix}`;
    seedPendingProject(pendingName);

    // Create an approved project through the real admin UI so it goes
    // through the actual app code path, not a DB shortcut.
    await adminLogin(page);
    await page.goto('/admin/budget.html');
    await page.click('#new-project-btn');

    const approvedName = `Одобрен Е2Е проект ${uniqueSuffix}`;
    await page.fill('#pf-name', approvedName);
    await page.fill('#pf-category', 'Тест E2E');
    await page.click('#project-form button[type="submit"]');
    await expect(page.locator('#detail-project-name')).toHaveText(approvedName);

    await page.goto('/budget/');
    await expect(page.locator('#projects-tbody')).toContainText(approvedName);
    await expect(page.locator('#projects-tbody')).not.toContainText(pendingName);
  });

  test('admin can create a project, add a budget line and expenditure, and see it reflected on the public detail page', async ({ page }) => {
    const uniqueSuffix = Date.now();
    const projectName = `Проект с бюджет ${uniqueSuffix}`;

    await adminLogin(page);
    await page.goto('/admin/budget.html');

    await page.click('#new-project-btn');
    await page.fill('#pf-name', projectName);
    await page.fill('#pf-category', 'Инфраструктура E2E');
    await page.click('#project-form button[type="submit"]');
    await expect(page.locator('#detail-project-name')).toHaveText(projectName);

    await page.click('#new-budget-line-btn');
    await page.fill('#bl-year', '2025');
    await page.fill('#bl-funding-source', 'Общински бюджет');
    await page.fill('#bl-amount', '12000');
    await page.click('#budget-line-form button[type="submit"]');
    await expect(page.locator('#budget-lines-tbody')).toContainText('Общински бюджет');

    await page.click('#new-expenditure-btn');
    await page.fill('#exp-vendor', 'Тест Доставчик ЕООД');
    await page.fill('#exp-amount', '3000');
    await page.click('#expenditure-form button[type="submit"]');
    await expect(page.locator('#expenditures-tbody')).toContainText('Тест Доставчик ЕООД');

    // Grab the project id from the admin list to visit its public detail page directly.
    await page.goto('/admin/budget.html');
    const row = page.locator('#projects-tbody tr', { hasText: projectName });
    const openButton = row.locator('[data-open]');
    const projectId = await openButton.getAttribute('data-open');

    await page.goto(`/budget/project.html?id=${projectId}`);
    await expect(page.locator('#project-content')).toContainText(projectName);
    await expect(page.locator('#project-content')).toContainText('Общински бюджет');
    await expect(page.locator('#project-content')).toContainText('Тест Доставчик ЕООД');
  });

  test('mutating budget routes return 401 with no session cookie (pen-test)', async ({ page, request }) => {
    const res = await request.post('/api/projects', { data: { name: 'Неоторизиран проект' } });
    expect(res.status()).toBe(401);
  });
});
