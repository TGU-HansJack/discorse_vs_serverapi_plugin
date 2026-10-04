import { defineConfig } from "@playwright/test";

const port = process.env.PORT || "4179";
export default defineConfig({
  testDir: "./tests",
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1100, height: 900 } },
  webServer: { command: "npm run preview", url: `http://127.0.0.1:${port}`, reuseExistingServer: !process.env.CI },
});
