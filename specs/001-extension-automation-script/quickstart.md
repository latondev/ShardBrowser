# Quickstart: Extension Automation Script

## Prerequisites

- Node.js v18+
- ShardBrowser installed and accessible
- Chrome extension built at `F:\ToolAllvideo\Extension\flow-automation-auto-flow`

## Setup

```bash
cd Testing/flow
npm init -y
npm install puppeteer commander winston
```

## Configuration

Create `config.json` in `Testing/flow/`:

```json
{
  "url": "https://example.com/target-page",
  "startIndex": 1,
  "prompt": "Hello, world!",
  "options": {
    "dropdown": "option1",
    "checkbox": true
  },
  "timeout": 30
}
```

## Run

```bash
node test-extension-flow.js --config config.json --profile "Profile1"
```

## Validation

Check logs in `Testing/flow/logs/` for success/error details.