'use strict';

async function gotoHome(page, path = '/') {
  await page.goto(path);
}

async function adminLogin(page, { username = 'admin', password = 'admin123' } = {}) {
  await page.goto('/admin/index.html');
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('#login-submit');
  await page.waitForURL('**/admin/dashboard.html');
}

module.exports = { gotoHome, adminLogin };
