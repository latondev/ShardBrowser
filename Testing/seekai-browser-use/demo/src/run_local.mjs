import "dotenv/config"
import { chromium } from "playwright"
import { readConfig } from "./config.mjs"
import { runSeekAiFlow } from "./seekai_flow.mjs"

const config = readConfig()
const context = await chromium.launchPersistentContext(config.localProfileDir, {
  headless: config.headless,
  viewport: null,
})

try {
  const page = context.pages()[0] || (await context.newPage())
  const result = await runSeekAiFlow(page, context, config)
  console.log(JSON.stringify(result))
} finally {
  if (!config.keepBrowser) await context.close()
}
