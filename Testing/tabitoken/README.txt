TABITOKEN JAVASCRIPT AUTOMATION

Requirements:
- Node.js 18 or newer

Install:
1. Put tabitoken_automation.js and package.json in the same folder.
2. Open a terminal in that folder.
3. Run: npm install
4. Run: npx playwright install chromium

Windows PowerShell:

$env:TABITOKEN_GITHUB_EMAIL = "your-github-email"
$env:TABITOKEN_GITHUB_PASSWORD = "your-github-password"
$env:TABITOKEN_GITHUB_TOTP_SECRET = "your-2fa-secret"
$env:TABITOKEN_API_KEY_NAME = "Auto_API_Key_01"

node .\tabitoken_automation.js

Linux or macOS:

export TABITOKEN_GITHUB_EMAIL="your-github-email"
export TABITOKEN_GITHUB_PASSWORD="your-github-password"
export TABITOKEN_GITHUB_TOTP_SECRET="your-2fa-secret"
export TABITOKEN_API_KEY_NAME="Auto_API_Key_01"

node ./tabitoken_automation.js

The script prints:

success|github_account|api_key

The script creates the TOTP code locally in JavaScript. Python is not needed.