const SECRET_KEY = /^(password|passwordhash|passwordconfirm|token|accesstoken|refreshtoken|secret|cookie|authorization|phrase|code|codehash|encryptedcode|totp|totpsecret|session|sessionhash|credential|bottoken|fallback|yjsstate|documentsstate|textsnapshot)$/i

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]'
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1))
  if (!value || typeof value !== 'object') return value
  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    output[key] = SECRET_KEY.test(key) ? '[redacted]' : redact(entry, depth + 1)
  }
  return output
}
