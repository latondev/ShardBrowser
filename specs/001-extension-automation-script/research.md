# Research: Extension Automation with ShardBrowser

## CDP Connection via Puppeteer

**Decision**: Use Puppeteer's `connect` method to attach to existing Chrome instance over CDP.

**Rationale**: ShardBrowser launches Chrome with remote debugging enabled. Puppeteer can connect to `http://localhost:9222` and control the browser via CDP. This avoids launching a new browser instance and preserves the ShardBrowser profile.

**Alternatives Considered**:
- Playwright: similar capability but Puppeteer is lighter and more straightforward for Chrome-only automation.
- Direct WebSocket CDP client: more complex, requires manual protocol handling.

## Extension Loading

**Decision**: Load extension via Chrome command-line flag `--disable-extensions-except` and `--load-extension` when launching ShardBrowser profile.

**Rationale**: ShardBrowser supports launching with flags. The extension directory must be absolute. This ensures the extension is loaded before script connects.

**Alternative**: Load extension after connection via `chrome.developerPrivate` API – requires extension management permissions and is less reliable.

## Form Interaction

**Decision**: Use Puppeteer's DOM manipulation (`.type()`, `.click()`, `.select()`) with explicit waitForSelector and timeout.

**Rationale**: Direct DOM interaction is reliable and matches typical user behavior. Use `waitForSelector` with configurable timeout to handle dynamic loading.

**Alternative**: Inject JavaScript to modify form values – faster but less robust against UI changes.

## Logging Strategy

**Decision**: Use `winston` logger with console and file transports. Log levels: error, warn, info, debug. Logs stored in `Testing/flow/logs/`.

**Rationale**: Structured logging helps debugging and monitoring. Rotation via `winston-daily-rotate-file` for long-term runs.

## Exception Handling

**Decision**: Wrap each step in try-catch with specific error types (TimeoutError, ConnectionError, SelectorNotFoundError). Exit with non-zero code on critical failures.

**Rationale**: Clear error classification allows appropriate recovery or graceful exit.