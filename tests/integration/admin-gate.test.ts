import { loadProjectEnv } from '@livebrary/database/load-env'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

process.env.DISCORD_CLIENT_ID ||= 'test-client-id'
process.env.DISCORD_CLIENT_SECRET ||= 'test-client-secret'
loadProjectEnv()
process.env.REQUIRE_DISCORD_SIGNUP ??= 'false'

const enabled = process.env.LIVEBRARY_INTEGRATION === '1'
const origin = 'http://127.0.0.1:5173'
const adminEmail = 'gate_admin_test@livebrary.test'
const userEmail = 'gate_user_test@livebrary.test'
const password = 'LibraryPass1'
const linkedDiscordId = '100000000000000001'
const otherDiscordId = '100000000000000002'

describe('admin entry: black screen code, login, Discord QR', () => {
  if (!enabled) {
    it('runs when LIVEBRARY_INTEGRATION=1', () => {
      expect(process.env.LIVEBRARY_INTEGRATION).not.toBe('1')
    })
    return
  }

  let app: unknown
  let supertest: typeof import('supertest')
  let prisma: typeof import('@livebrary/database').prisma

  beforeAll(async () => {
    ;({ prisma } = await import('@livebrary/database'))
    const { hashSecret } = await import('@livebrary/database/password')
    const { createApp } = await import('../../apps/api/src/app.ts')
    const { setDiscordExchangeForTests } = await import('../../apps/api/src/discord-oauth.ts')
    setDiscordExchangeForTests(async (code) => code === 'linked' ? linkedDiscordId : otherDiscordId)
    supertest = (await import('supertest')).default
    app = createApp()
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, userEmail] } } })
    await prisma.user.create({
      data: {
        email: adminEmail,
        username: 'gate_admin_test',
        usernameNormalized: 'gate_admin_test',
        passwordHash: await hashSecret(password),
        systemRole: 'SYSTEM_ADMIN',
        discordUserId: linkedDiscordId,
        discordLinkedAt: new Date(),
        preference: { create: {} },
      },
    })
  }, 60_000)

  afterAll(async () => {
    await prisma?.user.deleteMany({ where: { email: { in: [adminEmail, userEmail] } } })
  })

  function agent() {
    return supertest.agent(app as Parameters<typeof supertest.agent>[0])
  }

  function stateOf(url: string): string {
    return new URL(url).searchParams.get('state') ?? ''
  }

  it('rejects a wrong code without opening the gate', async () => {
    const client = agent()
    const wrong = await client.post('/api/gate/admin').set('Origin', origin).send({ phrase: 'notthecode' })
    expect(wrong.status).toBe(401)
    expect(String(wrong.headers['set-cookie'] ?? '')).not.toContain('lb_gate=')
  })

  it('opens the console only after the linked Discord account approves the QR', async () => {
    const client = agent()
    const phone = agent()
    const gate = await client.post('/api/gate/admin').set('Origin', origin).send({ phrase: 'Trust' })
    expect(gate.status).toBe(200)
    expect(String(gate.headers['set-cookie'] ?? '')).toContain('lb_admin_pre=')
    const csrf = cookieValue(gate.headers['set-cookie'], 'lb_csrf')
    const post = (path: string) => client.post(path).set('Origin', origin).set('x-csrf-token', csrf).send({})

    const login = await client.post('/api/auth/login').set('Origin', origin).set('x-csrf-token', csrf).send({ email: adminEmail, password })
    expect(login.status).toBe(200)
    expect((await client.get('/api/admin/dashboard')).status).toBe(401)
    expect((await post('/api/admin/discord-auth/start')).status).toBe(401)

    expect((await post('/api/admin/access/continue')).status).toBe(200)

    const first = await post('/api/admin/discord-auth/start')
    expect(first.status).toBe(200)
    const firstUrl = new URL(first.body.authorizeUrl as string)
    expect(firstUrl.origin).toBe('https://discord.com')
    expect(firstUrl.searchParams.get('scope')).toBe('identify')
    expect(firstUrl.searchParams.get('redirect_uri')).toMatch(/\/api\/oauth\/discord\/callback$/)

    expect((await post('/api/admin/discord-auth/poll')).body.status).toBe('pending')
    const mismatch = await phone.get(`/api/oauth/discord/callback?code=other&state=${stateOf(first.body.authorizeUrl)}`)
    expect(mismatch.status).toBe(403)
    expect((await post('/api/admin/discord-auth/poll')).body.status).toBe('denied')
    expect((await client.get('/api/admin/dashboard')).status).toBe(401)

    const second = await post('/api/admin/discord-auth/start')
    const state = stateOf(second.body.authorizeUrl)
    const approved = await phone.get(`/api/oauth/discord/callback?code=linked&state=${state}`)
    expect(approved.status).toBe(200)
    expect(approved.text).toContain('APPROVED')

    const poll = await post('/api/admin/discord-auth/poll')
    expect(poll.body.status).toBe('approved')
    expect((await client.get('/api/admin/dashboard')).status).toBe(200)

    const replay = await phone.get(`/api/oauth/discord/callback?code=linked&state=${state}`)
    expect(replay.status).toBe(410)
    expect((await post('/api/admin/access/continue')).status).toBe(401)
  })

  it('opens the console when the admin confirms the entry code', async () => {
    const client = agent()
    const gate = await client.post('/api/gate/admin').set('Origin', origin).send({ phrase: 'Trust' })
    expect(gate.status).toBe(200)
    const csrf = cookieValue(gate.headers['set-cookie'], 'lb_csrf')
    const post = (path: string, body: unknown) => client.post(path).set('Origin', origin).set('x-csrf-token', csrf).send(body)
    expect((await post('/api/auth/login', { email: adminEmail, password })).status).toBe(200)
    expect((await post('/api/admin/access/continue', {})).status).toBe(200)
    expect((await post('/api/admin/access-code', { code: 'notthecode' })).status).toBe(401)
    expect((await client.get('/api/admin/dashboard')).status).toBe(401)
    expect((await post('/api/admin/access-code', { code: 'Trust' })).status).toBe(200)
    expect((await client.get('/api/admin/dashboard')).status).toBe(200)
  })

  it('does not grant admin to a normal account that knows the code', async () => {
    const client = agent()
    const gate = await client.post('/api/gate/admin').set('Origin', origin).send({ phrase: 'TRUST' })
    expect(gate.status).toBe(200)
    const csrf = cookieValue(gate.headers['set-cookie'], 'lb_csrf')
    const registered = await client.post('/api/auth/register').set('Origin', origin).set('x-csrf-token', csrf).send({
      email: userEmail,
      username: 'gate_user_test',
      password,
      passwordConfirm: password,
    })
    expect(registered.status).toBe(201)
    expect((await client.post('/api/admin/access/continue').set('Origin', origin).set('x-csrf-token', csrf).send({})).status).toBe(403)
    expect((await client.post('/api/admin/discord-auth/start').set('Origin', origin).set('x-csrf-token', csrf).send({})).status).toBe(401)
    expect((await client.post('/api/admin/discord-auth/poll').set('Origin', origin).set('x-csrf-token', csrf).send({})).status).toBe(404)

    const logout = await client.post('/api/auth/logout').set('Origin', origin).set('x-csrf-token', csrf).send({})
    expect(logout.status).toBe(200)
    expect((await client.get('/api/gate/status')).body.active).toBe(false)
  })
})

function cookieValue(header: string | string[] | undefined, name: string): string {
  const rows = Array.isArray(header) ? header : header ? [header] : []
  const row = rows.find((item) => item.startsWith(`${name}=`))
  return row?.split(';')[0]?.slice(name.length + 1) ?? ''
}
