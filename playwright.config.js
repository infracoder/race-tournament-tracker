const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test/browser',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3108', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'webkit-mobile', use: { ...devices['iPhone 13'], browserName: 'webkit' } }
  ],
  webServer: { command: 'node test/browser/server.cjs', url: 'http://127.0.0.1:3108/health', reuseExistingServer: false, timeout: 20000 }
});
