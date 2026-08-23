# Extension Automation Script for ShardBrowser

## Prerequisites
- Node.js v18+
- ShardBrowser installed
- Chrome extension built at `F:\ToolAllvideo\Extension\flow-automation-auto-flow`

## Setup
```bash
cd Testing/flow
npm install
```

## Configuration
Create `config.json` based on `config.sample.json`:
- `url`: Target webpage URL
- `startIndex`: Starting index value
- `prompt`: Custom prompt text
- `options`: Dropdown/checkbox selections
- `extensionPath`: Path to extension folder
- `shardBrowserPath`: (Optional) Path to ShardBrowser executable
- `debugPort`: CDP port (default 9222)
- `timeout`: Timeout in seconds
- `logLevel`: error/warn/info/debug

## Run
```bash
# Using default config.json
npm start

# Using custom config
npm start -- --config my-config.json

# Or directly
node test-extension-flow.js --config config.json
```

## Logs
Logs are written to `logs/combined.log` and `logs/error.log`.

## Development
```bash
npm run build   # Compile TypeScript
npm run dev     # Run with ts-node
```