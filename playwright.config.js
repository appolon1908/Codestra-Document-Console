import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 15000,
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:18765",
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: "off",
    screenshot: "off",
  },
  webServer: {
    command:
      ".venv/bin/uvicorn console.app:create_app --factory --host 127.0.0.1 --port 18765 --no-access-log",
    url: "http://127.0.0.1:18765/healthz",
    reuseExistingServer: false,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
});
