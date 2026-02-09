// @ts-check
const { defineConfig, devices } = require('@playwright/test')

/**
 * Playwright configuration for E2E tests
 */
module.exports = defineConfig({
  testDir: './test/e2e',
  
  /* Maximum time one test can run for */
  timeout: 60 * 1000,
  
  expect: {
    timeout: 10000
  },
  
  /* Run tests in files in parallel */
  fullyParallel: false,
  
  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,
  
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  
  /* Opt out of parallel tests */
  workers: 1,
  
  /* Reporter to use */
  reporter: 'html',
  
  /* Shared settings for all the projects below */
  use: {
    /* Collect trace when retrying the failed test */
    trace: 'on-first-retry',
  },

  /* Configure projects for electron */
  projects: [
    {
      name: 'electron',
      use: {},
    },
  ],
})
