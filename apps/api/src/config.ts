import { loadProjectEnv } from '@livebrary/database/load-env'

loadProjectEnv()

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

const sessionSecret = required('SESSION_SECRET')
if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters')

const appOrigin = process.env.APP_ORIGIN?.trim() || 'http://127.0.0.1:5173'
const apiPort = Number(process.env.API_PORT ?? process.env.PORT ?? 3001)
const tlsCertPath = process.env.TLS_CERT_PATH?.trim() ?? ''
const serveWeb = process.env.SERVE_WEB === '1'
const scheme = tlsCertPath ? 'https' : 'http'
const serverOrigin = `${scheme}://127.0.0.1:${apiPort}`
const renderOrigin = process.env.RENDER_EXTERNAL_URL?.trim() || ''

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',
  serveWeb,
  sessionSecret,
  encryptionSecret: required('ADMIN_CODE_ENCRYPTION_KEY'),
  fallbackCode: process.env.ADMIN_FALLBACK_CODE?.trim() || 'Trust',
  appOrigin,
  publicOrigin: process.env.PUBLIC_ORIGIN?.trim() || renderOrigin || (serveWeb ? serverOrigin : appOrigin),
  discordClientId: process.env.DISCORD_CLIENT_ID?.trim() ?? '',
  discordClientSecret: process.env.DISCORD_CLIENT_SECRET?.trim() ?? '',
  apiPort,
  listenHost: process.env.HOST?.trim() || '127.0.0.1',
  collabPort: Number(process.env.COLLAB_PORT ?? 1234),
  secureCookies: process.env.NODE_ENV === 'production' || process.env.FORCE_SECURE_COOKIES === 'true',
  tlsCertPath,
  tlsKeyPath: process.env.TLS_KEY_PATH?.trim() ?? '',
  redisUrl: process.env.REDIS_URL?.trim() ?? '',
}

export const GATE_MS = 12 * 60 * 60 * 1000
export const SESSION_MS = 7 * 24 * 60 * 60 * 1000
export const ADMIN_MS = 15 * 60 * 1000

export function originAllowed(origin: string | null | undefined, requestHost?: string | null): boolean {
  if (!origin) return false
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  const allowed = new Set([
    config.appOrigin,
    config.publicOrigin,
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    `http://127.0.0.1:${config.apiPort}`,
    `http://localhost:${config.apiPort}`,
    `https://127.0.0.1:${config.apiPort}`,
    `https://localhost:${config.apiPort}`,
  ])
  if (allowed.has(origin)) return true
  return Boolean(requestHost) && parsed.host === requestHost
}
