import process from 'node:process';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 30_000,
  outputDir: '.ui-results',
  reporter: 'list',
  snapshotPathTemplate: '{testDir}/snapshots/{platform}/{arg}{ext}',
  use: { browserName: 'chromium', locale: 'en', timezoneId: 'UTC', reducedMotion: 'reduce', trace: 'off' },
  expect: { toHaveScreenshot: { animations: 'disabled', maxDiffPixelRatio: 0.001 } },
  webServer: {
    command: 'node scripts/serve-ui.mjs',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: false
  }
});
