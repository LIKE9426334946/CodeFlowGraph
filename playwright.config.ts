import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45000,
  expect: { timeout: 8000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3047",
    viewport: { width: 1440, height: 960 },
    headless: true,
    launchOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
        : {}),
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node backend/server.js",
    url: "http://127.0.0.1:3047/api/health",
    env: {
      PORT: "3047",
      HOST: "127.0.0.1",
      DATA_DIR:
        process.env.CFG_TEST_DATA_DIR || `/tmp/codeflowgraph-e2e-${Date.now()}`,
    },
    reuseExistingServer: false,
  },
});
