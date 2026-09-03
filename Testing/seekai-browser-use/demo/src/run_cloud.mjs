import "dotenv/config"
import { BrowserUse } from "browser-use-sdk/v3"
import { chromium } from "playwright"
import { readConfig } from "./config.mjs"
import { runSeekAiFlow } from "./seekai_flow.mjs"

const config = readConfig({ cloud: true })
const client = new BrowserUse()
let managedBrowser
let playwrightBrowser

try {
  managedBrowser = await client.browsers.create({
    proxyCountryCode: config.proxyCountry,
  })

  playwrightBrowser = await chromium.connectOverCDP(managedBrowser.cdpUrl)
  const context = playwrightBrowser.contexts()[0]
  const page = context.pages()[0] || (await context.newPage())
  const result = await runSeekAiFlow(page, context, config)

  console.log(JSON.stringify(result))
} finally {
  if (managedBrowser) {
    await client.browsers.stop(managedBrowser.id).catch(() => {})
  }
  await playwrightBrowser?.close().catch(() => {})
}
