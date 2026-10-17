import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  tsconfig: "./tsconfig.node.json",
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3030",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run build && npm run preview -- --host 127.0.0.1 --port 3030 --strictPort",
    url: "http://127.0.0.1:3030",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
