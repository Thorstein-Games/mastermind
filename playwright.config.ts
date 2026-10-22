import { defineConfig, devices } from "@playwright/test";

const PORT = 4317;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Dates in the tests are UTC noon, so every test sees the same calendar day.
    timezoneId: "UTC",
    locale: "en-US",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // A production build (without the shared bar script), served like the real proxy.
    command: `npm run build:e2e && node e2e/serve.mjs dist-e2e`,
    env: { PORT: String(PORT) },
    url: `http://localhost:${PORT}/mastermind`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
