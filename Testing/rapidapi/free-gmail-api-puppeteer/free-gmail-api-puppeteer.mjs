#!/usr/bin/env node

import puppeteer from "puppeteer"

const API_BASE = "https://free-gmail-api.p.rapidapi.com"
const API_HOST = "free-gmail-api.p.rapidapi.com"
const apiKey = process.env.RAPIDAPI_KEY

if (!apiKey) {
  throw new Error("Missing RAPIDAPI_KEY environment variable")
}

const command = process.argv[2] || "demo"

function required(value, name) {
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

async function requestFromBrowser(page, path, body) {
  const request = { url: `${API_BASE}${path}`, key: apiKey, host: API_HOST, body }

  try {
    return await page.evaluate(async ({ url, key, host, body: requestBody }) => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-rapidapi-host": host,
          "x-rapidapi-key": key,
        },
        body: JSON.stringify(requestBody),
      })

      const text = await response.text()
      let data
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
      return { status: response.status, ok: response.ok, data }
    }, request)
  } catch (browserError) {
    // Some remote browser origins block cross-origin fetch. Node fetch is the fallback.
    const response = await fetch(request.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-rapidapi-host": request.host,
        "x-rapidapi-key": request.key,
      },
      body: JSON.stringify(request.body),
    })
    const text = await response.text()
    let data
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
    return { status: response.status, ok: response.ok, data, fallback: browserError.message }
  }
}

async function callApi(page, path, body) {
  const result = await requestFromBrowser(page, path, body)
  if (!result.ok) {
    throw new Error(`RapidAPI ${path} returned HTTP ${result.status}: ${JSON.stringify(result.data)}`)
  }
  return result.data
}

function getEmail(data) {
  return data?.email || data?.data?.email || data?.result?.email || null
}

async function connectBrowser() {
  const wsEndpoint = process.env.BROWSER_WS_ENDPOINT || process.env.BROWSER_SDK_WS
  if (wsEndpoint) {
    return {
      browser: await puppeteer.connect({ browserWSEndpoint: wsEndpoint, defaultViewport: null }),
      launched: false,
    }
  }

  if (process.env.CDP_URL) {
    return {
      browser: await puppeteer.connect({ browserURL: process.env.CDP_URL, defaultViewport: null }),
      launched: false,
    }
  }

  return {
    browser: await puppeteer.launch({
      headless: process.env.HEADLESS !== "false",
      defaultViewport: null,
      args: process.env.HEADLESS === "false" ? ["--start-maximized"] : [],
    }),
    launched: true,
  }
}

async function main() {
  const { browser, launched } = await connectBrowser()
  const page = await browser.newPage()

  try {
    // Establish the API origin for the browser-side fetch attempt.
    await page.goto(API_BASE, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined)

    if (command === "generate") {
      const data = await callApi(page, "/generate-email", { email: ["Gmail"] })
      console.log(JSON.stringify(data, null, 2))
      return
    }

    if (command === "inbox") {
      const email = required(process.argv[3], "email")
      const data = await callApi(page, "/message-list", { email })
      console.log(JSON.stringify(data, null, 2))
      return
    }

    if (command === "details") {
      const email = required(process.argv[3], "email")
      const messageId = required(process.argv[4], "message id")
      const data = await callApi(page, "/message-details", { email, message_id: messageId })
      console.log(JSON.stringify(data, null, 2))
      return
    }

    if (command !== "demo") {
      throw new Error("Usage: generate | inbox <email> | details <email> <message_id> | demo")
    }

    const generated = await callApi(page, "/generate-email", { email: ["Gmail"] })
    const email = getEmail(generated)
    if (!email) throw new Error(`Could not find generated email in response: ${JSON.stringify(generated)}`)

    const inbox = await callApi(page, "/message-list", { email })
    console.log(JSON.stringify({ email, inbox }, null, 2))
  } finally {
    if (launched) await browser.close()
    else browser.disconnect()
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`)
  process.exitCode = 1
})
