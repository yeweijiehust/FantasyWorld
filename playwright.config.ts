import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure"
  },
  webServer: [
    {
      command: "pnpm --filter @fantasy-world/api dev",
      url: "http://127.0.0.1:4000/api/health",
      reuseExistingServer: !process.env.CI
    },
    {
      command: "pnpm --filter @fantasy-world/web dev",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI
    }
  ],
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 7"] }
    }
  ]
});
