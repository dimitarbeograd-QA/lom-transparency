'use strict';

const { test, expect } = require('@playwright/test');
const { adminLogin } = require('./helpers');

test.describe('admin authentication', () => {
  test('admin can log in via the real form and reach the dashboard', async ({ page }) => {
    await adminLogin(page);
    await expect(page).toHaveURL(/\/admin\/dashboard\.html/);
  });

  test('wrong password shows an error and does not redirect', async ({ page }) => {
    await page.goto('/admin/index.html');
    await page.fill('#username', 'admin');
    await page.fill('#password', 'not-the-right-password');
    await page.click('#login-submit');

    await expect(page.locator('#login-error')).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/index\.html/);
  });

  test('visiting the dashboard without being logged in redirects to the login page', async ({ page }) => {
    await page.goto('/admin/dashboard.html');
    await expect(page).toHaveURL(/\/admin\/index\.html/);
  });

  test('logout clears the session', async ({ page }) => {
    await adminLogin(page);
    await expect(page).toHaveURL(/\/admin\/dashboard\.html/);

    await page.click('#logout-link');
    await expect(page).toHaveURL(/\/admin\/index\.html/);

    await page.goto('/admin/dashboard.html');
    await expect(page).toHaveURL(/\/admin\/index\.html/);
  });
});
