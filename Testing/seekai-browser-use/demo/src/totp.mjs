import { TOTP } from "otpauth"

export function createTotp(secret) {
  const normalized = secret.replace(/\s+/g, "")
  if (!normalized) throw new Error("GITHUB_TOTP_SECRET is empty")

  return new TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: normalized,
  })
}

export function getTotpCode(secret) {
  return createTotp(secret).generate()
}
