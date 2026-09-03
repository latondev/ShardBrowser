function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing environment variable: ${name}`)
  return value
}

export function readConfig({ cloud = false } = {}) {
  if (cloud) required("BROWSER_USE_API_KEY")

  return {
    githubLogin: required("GITHUB_LOGIN"),
    githubPassword: required("GITHUB_PASSWORD"),
    githubTotpSecret: required("GITHUB_TOTP_SECRET"),
    githubExpectedUsername: required("GITHUB_EXPECTED_USERNAME"),
    keyName: process.env.SEEKAI_API_KEY_NAME?.trim() || "Auto_API_Key_01",
    proxyCountry: process.env.BROWSER_PROXY_COUNTRY?.trim() || "us",
    headless: process.env.HEADLESS === "1",
    keepBrowser: process.env.KEEP_BROWSER === "1",
    localProfileDir: process.env.LOCAL_PROFILE_DIR?.trim() || ".local-browser-profile",
  }
}
