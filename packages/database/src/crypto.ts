import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto'

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function encryptionKeyFrom(secret: string): Buffer {
  const decoded = Buffer.from(secret, 'base64')
  if (decoded.length === 32) return decoded
  return scryptSync(secret, 'livebrary-admin-code', 32)
}

export function encryptString(plain: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64url')
}

export function decryptString(payload: string, key: Buffer): string {
  const data = Buffer.from(payload, 'base64url')
  const iv = data.subarray(0, 12)
  const tag = data.subarray(12, 28)
  const encrypted = data.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
