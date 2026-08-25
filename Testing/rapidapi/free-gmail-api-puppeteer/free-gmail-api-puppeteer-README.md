# Free Gmail API with Puppeteer

## Install

Requires Node.js 18 or newer.

```bash
npm init -y
npm install puppeteer
```

The script reads the key from `RAPIDAPI_KEY`; it is intentionally not stored in the source file.

## Run with local Chromium

Linux/macOS:

```bash
export RAPIDAPI_KEY='your-rapidapi-key'
node free-gmail-api-puppeteer.mjs
```

Windows PowerShell:

```powershell
$env:RAPIDAPI_KEY = 'your-rapidapi-key'
node .\free-gmail-api-puppeteer.mjs
```

The default `demo` command creates a temporary address and reads its inbox.

## Commands

```bash
node free-gmail-api-puppeteer.mjs generate
node free-gmail-api-puppeteer.mjs inbox user@gmail.com
node free-gmail-api-puppeteer.mjs details user@gmail.com MESSAGE_ID
node free-gmail-api-puppeteer.mjs demo
```

## Connect to Browser SDK or CDP

If your browser SDK provides a Puppeteer-compatible WebSocket endpoint:

```bash
export RAPIDAPI_KEY='your-rapidapi-key'
export BROWSER_WS_ENDPOINT='wss://your-browser-cdp-endpoint'
node free-gmail-api-puppeteer.mjs demo
```

For a local Chrome debug endpoint, use `CDP_URL` instead:

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir="$PWD/chrome-profile"
export RAPIDAPI_KEY='your-rapidapi-key'
export CDP_URL='http://127.0.0.1:9222'
node free-gmail-api-puppeteer.mjs demo
```

`BROWSER_WS_ENDPOINT` takes priority over `CDP_URL`. If neither is set, Puppeteer starts its own Chromium.

## Security

- Do not commit the API key or put it directly in the script.
- If the key is exposed publicly, revoke it in RapidAPI and create a replacement.
- This example is for authorized testing of the subscribed API only.
