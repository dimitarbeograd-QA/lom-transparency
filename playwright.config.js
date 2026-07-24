'use strict';

const path = require('path');
const { defineConfig, devices } = require('@playwright/test');

const TEST_DB_PATH = path.join(__dirname, 'server', 'lom.test.db');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  use: {
    baseURL: 'http://localhost:3080',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 10000,
  },
  webServer: {
    command: 'node scripts/reset-test-db-and-start.js',
    cwd: './server',
    url: 'http://localhost:3080',
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      PORT: '3080',
      LOM_DB_PATH: TEST_DB_PATH,
      LOM_ADMIN_USERNAME: 'admin',
      LOM_ADMIN_PASSWORD: 'admin123',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
