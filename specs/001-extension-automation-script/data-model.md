# Data Model: Extension Automation Script

## TestConfig

Configuration for a test run.

| Field | Type | Description |
|-------|------|-------------|
| startIndex | number | Starting index for the flow |
| prompt | string | Custom prompt text |
| url | string | Target webpage URL |
| options | object | Dropdown/checkbox selections |
| timeout | number | Max wait time (seconds) |

## BrowserSession

Represents an active browser connection.

| Field | Type | Description |
|-------|------|-------------|
| browser | object | Puppeteer Browser instance |
| page | object | Puppeteer Page instance |
| cdpUrl | string | WebSocket URL for CDP |
| profileName | string | Name of ShardBrowser profile |

## ExtensionUI

Selectors and state of the extension UI.

| Field | Type | Description |
|-------|------|-------------|
| popupSelector | string | CSS selector for popup |
| startIndexSelector | string | Selector for startIndex input |
| promptSelector | string | Selector for prompt textarea |
| startButtonSelector | string | Selector for start/run button |
| dropdownSelector | string | Selector for dropdown |
| checkboxSelector | string | Selector for checkbox |

## LogEntry

Structured log record.

| Field | Type | Description |
|-------|------|-------------|
| timestamp | string | ISO timestamp |
| level | string | info/warn/error/debug |
| message | string | Log message |
| step | string | Current step identifier |
| data | object | Additional context (optional) |