import { defineConfig, devices } from '@playwright/test';

// End-to-end flows. The dev server is started automatically.
// YouTube is never contacted in CI; tests inject a stub window.YT.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Local retries are 0: a flake must be fixed at its cause, not hidden by a
  // retry. CI keeps a small retry budget for infrastructure hiccups.
  retries: process.env.CI ? 2 : 0,
  // These tests drive real WebGL pixel readback and Web Audio. Too many browser
  // contexts against the single dev server starve backgrounded tabs' rAF loops,
  // which stalls canvas rendering and makes pixel samples flaky. Cap workers so
  // every tab gets enough scheduling: one on CI, a small pool locally.
  workers: process.env.CI ? 1 : 2,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // PW_GPU=1 uses the machine's real GPU. Software WebGL cannot keep up with
        // long drags at 1440x900: the page stops answering and tests time out,
        // which says nothing about how the app runs on real hardware.
        ...(process.env.PW_GPU
          ? {
              channel: 'chromium',
              launchOptions: { args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] },
            }
          : {}),
      },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
