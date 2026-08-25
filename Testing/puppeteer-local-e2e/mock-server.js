const http = require('node:http');
const { URL } = require('node:url');

const TEST_OTP = '42981031';
const accounts = new Map();

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function page(title, content) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    ${content}
  </body>
</html>`;
}

function sendHtml(res, status, html) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

function redirect(res, location) {
  res.writeHead(303, { location });
  res.end();
}

function readForm(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(new URLSearchParams(body)));
    req.on('error', reject);
  });
}

function getAccount(email) {
  return accounts.get(String(email).toLowerCase());
}

function renderSignup() {
  return page('Local signup', `
    <h1>Create a local test account</h1>
    <form method="post" action="/api/signup">
      <label>Email <input name="email" type="email" required></label><br>
      <label>Password <input name="password" type="password" required></label><br>
      <label>Username <input name="username" required></label><br>
      <button data-testid="create-account" type="submit">Create account</button>
    </form>
  `);
}

function renderVerify(email) {
  const digits = Array.from({ length: TEST_OTP.length }, (_, index) => `
    <input data-testid="otp-digit" name="code[]" inputmode="numeric" maxlength="1" required aria-label="Digit ${index + 1}">
  `).join('');
  return page('Local verification', `
    <h1>Verify local test account</h1>
    <p>Verification code sent to <strong>${escapeHtml(email)}</strong></p>
    <form method="post" action="/api/verify">
      <input type="hidden" name="email" value="${escapeHtml(email)}">
      <div>${digits}</div>
      <button data-testid="verify" type="submit">Verify</button>
    </form>
  `);
}

function renderInbox(email) {
  const account = getAccount(email);
  const message = account
    ? `<p data-testid="verification-code">${TEST_OTP}</p>`
    : '<p>No message</p>';
  return page('Local inbox', `
    <h1>Mock inbox</h1>
    <p>Recipient: ${escapeHtml(email)}</p>
    ${message}
  `);
}

function renderLogin() {
  return page('Local login', `
    <h1>Sign in to local test app</h1>
    <form method="post" action="/api/login">
      <label>Username or email <input name="login" required></label><br>
      <label>Password <input name="password" type="password" required></label><br>
      <button data-testid="login" type="submit">Sign in</button>
    </form>
  `);
}

function renderDashboard(username) {
  return page('Local dashboard', `
    <h1 data-testid="dashboard">Welcome, ${escapeHtml(username)}</h1>
    <p data-testid="signed-in">Signed in successfully.</p>
  `);
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const email = url.searchParams.get('email') || '';

    if (req.method === 'GET' && url.pathname === '/signup') {
      return sendHtml(res, 200, renderSignup());
    }

    if (req.method === 'POST' && url.pathname === '/api/signup') {
      const form = await readForm(req);
      const accountEmail = form.get('email')?.trim().toLowerCase();
      const username = form.get('username')?.trim();
      const password = form.get('password');

      if (!accountEmail || !username || !password) {
        return sendHtml(res, 400, '<h1>Missing required test data</h1>');
      }
      if (getAccount(accountEmail)) {
        return sendHtml(res, 409, '<h1>Test account already exists</h1>');
      }

      accounts.set(accountEmail, {
        email: accountEmail,
        username,
        password,
        code: TEST_OTP,
        verified: false,
      });
      return redirect(res, `/verify?email=${encodeURIComponent(accountEmail)}`);
    }

    if (req.method === 'GET' && url.pathname === '/verify') {
      return getAccount(email)
        ? sendHtml(res, 200, renderVerify(email))
        : sendHtml(res, 404, '<h1>Test account not found</h1>');
    }

    if (req.method === 'GET' && url.pathname === '/inbox') {
      return sendHtml(res, 200, renderInbox(email));
    }

    if (req.method === 'POST' && url.pathname === '/api/verify') {
      const form = await readForm(req);
      const accountEmail = form.get('email')?.trim().toLowerCase();
      const account = getAccount(accountEmail);
      const code = form.getAll('code[]').join('');

      if (!account || code !== account.code) {
        return sendHtml(res, 400, '<h1>Invalid test verification code</h1>');
      }
      account.verified = true;
      return redirect(res, `/success?email=${encodeURIComponent(accountEmail)}`);
    }

    if (req.method === 'GET' && url.pathname === '/success') {
      return getAccount(email)?.verified
        ? sendHtml(res, 200, '<h1 data-testid="account-created">Account created and verified</h1>')
        : sendHtml(res, 403, '<h1>Account is not verified</h1>');
    }

    if (req.method === 'GET' && url.pathname === '/login') {
      return sendHtml(res, 200, renderLogin());
    }

    if (req.method === 'POST' && url.pathname === '/api/login') {
      const form = await readForm(req);
      const login = form.get('login')?.trim().toLowerCase();
      const password = form.get('password');
      const account = [...accounts.values()].find((item) =>
        item.verified && item.password === password &&
        (item.email === login || item.username.toLowerCase() === login));

      if (!account) return sendHtml(res, 401, '<h1>Invalid test credentials</h1>');
      return redirect(res, `/dashboard?username=${encodeURIComponent(account.username)}`);
    }

    if (req.method === 'GET' && url.pathname === '/dashboard') {
      return sendHtml(res, 200, renderDashboard(url.searchParams.get('username') || 'test user'));
    }

    sendHtml(res, 404, '<h1>Not found</h1>');
  });
}

function startMockServer(port = 0) {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

if (require.main === module) {
  startMockServer(process.env.PORT || 3000).then(({ baseUrl }) => {
    console.log(`Mock app running at ${baseUrl}`);
  });
}

module.exports = { startMockServer, TEST_OTP };
