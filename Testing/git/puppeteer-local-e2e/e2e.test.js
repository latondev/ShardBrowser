const puppeteer = require('puppeteer');
const { startMockServer, TEST_OTP } = require('./mock-server');

const TEST_EMAIL = 'researcher@example.test';
const TEST_USERNAME = 'puppeteer-researcher';
const TEST_PASSWORD = 'OnlyForLocalTesting-123!';

async function fill(page, selector, value) {
  await page.waitForSelector(selector, { visible: true });
  await page.click(selector, { clickCount: 3 });
  await page.type(selector, value);
}

async function connectOrLaunch() {
  const browserWSEndpoint = process.env.BROWSER_WS_ENDPOINT || process.env.BROWSER_USE_CDP_WS;
  const browserURL = process.env.BROWSER_CDP_URL || process.env.BROWSER_USE_CDP_URL;

  if (browserWSEndpoint) {
    return { browser: await puppeteer.connect({ browserWSEndpoint }), ownsBrowser: false };
  }
  if (browserURL) {
    return { browser: await puppeteer.connect({ browserURL }), ownsBrowser: false };
  }
  return { browser: await puppeteer.launch({ headless: true }), ownsBrowser: true };
}

async function main() {
  const { server, baseUrl } = await startMockServer();
  const { browser, ownsBrowser } = await connectOrLaunch();
  const signup = await browser.newPage();
  const inbox = await browser.newPage();

  try {
    // 1. Open the local signup page and fill test-only data.
    await signup.goto(`${baseUrl}/signup`, { waitUntil: 'networkidle0' });
    await fill(signup, '[name="email"]', TEST_EMAIL);
    await fill(signup, '[name="password"]', TEST_PASSWORD);
    await fill(signup, '[name="username"]', TEST_USERNAME);

    // 2. Submit signup and wait for the verification page.
    await Promise.all([
      signup.waitForNavigation({ waitUntil: 'networkidle0' }),
      signup.click('[data-testid="create-account"]'),
    ]);

    // 3. Read the deterministic OTP from the local mock inbox.
    await inbox.goto(`${baseUrl}/inbox?email=${encodeURIComponent(TEST_EMAIL)}`, {
      waitUntil: 'networkidle0',
    });
    const code = await inbox.$eval(
      '[data-testid="verification-code"]',
      (element) => element.textContent.trim(),
    );
    if (code !== TEST_OTP) throw new Error(`Unexpected OTP: ${code}`);

    // 4. Fill one digit per OTP input and verify the account.
    const digits = await signup.$$('[data-testid="otp-digit"]');
    if (digits.length !== code.length) throw new Error('OTP input count mismatch');
    for (let index = 0; index < digits.length; index += 1) {
      await digits[index].type(code[index]);
    }
    await Promise.all([
      signup.waitForNavigation({ waitUntil: 'networkidle0' }),
      signup.click('[data-testid="verify"]'),
    ]);
    await signup.waitForSelector('[data-testid="account-created"]', { visible: true });

    // 5. Sign in and assert that the dashboard is reachable.
    await signup.goto(`${baseUrl}/login`, { waitUntil: 'networkidle0' });
    await fill(signup, '[name="login"]', TEST_USERNAME);
    await fill(signup, '[name="password"]', TEST_PASSWORD);
    await Promise.all([
      signup.waitForNavigation({ waitUntil: 'networkidle0' }),
      signup.click('[data-testid="login"]'),
    ]);
    await signup.waitForSelector('[data-testid="dashboard"]', { visible: true });

    console.log(JSON.stringify({
      email: TEST_EMAIL,
      username: TEST_USERNAME,
      otp: code,
      status: 'verified-and-signed-in',
      dashboard: await signup.$eval('[data-testid="dashboard"]', (element) => element.textContent.trim()),
    }, null, 2));
  } finally {
    await signup.close();
    await inbox.close();
    if (ownsBrowser) await browser.close();
    else await browser.disconnect();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
