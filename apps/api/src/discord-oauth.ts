import { config } from './config.js'

const DISCORD_API = 'https://discord.com/api/v10'

type Exchange = (code: string) => Promise<string>

let exchangeOverride: Exchange | null = null

export function setDiscordExchangeForTests(fn: Exchange | null): void {
  exchangeOverride = fn
}

export function discordOAuthConfigured(): boolean {
  return Boolean(config.discordClientId && config.discordClientSecret)
}

export function discordRedirectUri(): string {
  return `${config.publicOrigin.replace(/\/$/, '')}/api/oauth/discord/callback`
}

export function discordAuthorizeUrl(state: string): string {
  const url = new URL('https://discord.com/oauth2/authorize')
  url.searchParams.set('client_id', config.discordClientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', discordRedirectUri())
  url.searchParams.set('scope', 'identify')
  url.searchParams.set('state', state)
  url.searchParams.set('prompt', 'consent')
  return url.toString()
}

/** Exchanges an OAuth code and returns the Discord user ID that approved it. */
export async function exchangeDiscordCode(code: string): Promise<string> {
  if (exchangeOverride) return exchangeOverride(code)
  const tokenResponse = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.discordClientId,
      client_secret: config.discordClientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: discordRedirectUri(),
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!tokenResponse.ok) throw new Error(`discord token exchange failed (${tokenResponse.status})`)
  const token = await tokenResponse.json() as { access_token?: string }
  if (!token.access_token) throw new Error('discord token exchange returned no token')
  try {
    const meResponse = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!meResponse.ok) throw new Error(`discord user lookup failed (${meResponse.status})`)
    const me = await meResponse.json() as { id?: string }
    if (!me.id || !/^\d{17,20}$/.test(me.id)) throw new Error('discord user id missing')
    return me.id
  } finally {
    void fetch(`${DISCORD_API}/oauth2/token/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.discordClientId,
        client_secret: config.discordClientSecret,
        token: token.access_token,
        token_type_hint: 'access_token',
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined)
  }
}
