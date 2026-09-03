import "dotenv/config"
import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  timeout: 120000,
  expect: {
    timeout: 15000,
  },
  use: {
    headless: process.env.HEADLESS !== "0",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
})
