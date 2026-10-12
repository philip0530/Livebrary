import { loadProjectEnv } from '@livebrary/database/load-env'
import { beforeAll, describe, expect, it } from 'vitest'

loadProjectEnv()

const enabled = process.env.LIVEBRARY_INTEGRATION === '1'

describe('api access control', () => {
  if (!enabled) {
    it('runs when LIVEBRARY_INTEGRATION=1', () => {
      expect(process.env.LIVEBRARY_INTEGRATION).not.toBe('1')
    })
    return
  }

  let request: Awaited<ReturnType<typeof loadApp>>

  beforeAll(async () => {
    const { prisma } = await import('@livebrary/database')
    const emails = ['owner_a@livebrary.test', 'guest_b@livebrary.test']
    await prisma.project.deleteMany({ where: { owner: { email: { in: emails } } } })
    await prisma.user.deleteMany({ where: { email: { in: emails } } })
    request = await loadApp()
  }, 60_000)

  it('keeps private projects away from another account', async () => {
    const owner = await register('owner_a@livebrary.test', 'owner_a')
    const guest = await register('guest_b@livebrary.test', 'guest_b')
    const created = await owner.post('/api/projects').send({ name: 'Private Lab', template: 'empty', visibility: 'PRIVATE' })
    expect(created.status).toBe(201)
    const projectId = created.body.project.id as string
    const denied = await guest.get(`/api/projects/${projectId}`)
    expect(denied.status).toBe(404)
    const invited = await owner.post(`/api/projects/${projectId}/invitations`).send({ username: 'guest_b', role: 'VIEWER' })
    expect(invited.status).toBe(201)
    const accepted = await guest.post(`/api/invitations/${invited.body.link.split('/invite/')[1]}/accept`).send({})
    expect(accepted.status).toBe(200)
    const files = await guest.get(`/api/projects/${projectId}/files`)
    const file = (files.body.files as { id: string; type: string }[]).find((item) => item.type === 'FILE')
    expect(file).toBeTruthy()
    const deleted = await guest.delete(`/api/projects/${projectId}/files/${file!.id}`)
    expect(deleted.status).toBe(403)
    const loggedOut = await guest.post('/api/auth/logout').send({})
    expect(loggedOut.status).toBe(200)
    const after = await guest.get('/api/auth/me')
    expect(after.status).toBe(401)
  })

  async function register(email: string, username: string) {
    const agent = request.agent()
    const gate = await agent.post('/api/gate/enter').set('Origin', origin).send({})
    expect(gate.status).toBe(200)
    const csrf = cookieValue(gate.headers['set-cookie'], 'lb_csrf')
    const response = await agent.post('/api/auth/register').set('Origin', origin).set('x-csrf-token', csrf).send({
      email,
      username,
      password: 'LibraryPass1',
      passwordConfirm: 'LibraryPass1',
    })
    expect(response.status).toBe(201)
    return {
      post: (path: string) => agent.post(path).set('Origin', origin).set('x-csrf-token', csrf),
      get: (path: string) => agent.get(path).set('Origin', origin),
      delete: (path: string) => agent.delete(path).set('Origin', origin).set('x-csrf-token', csrf),
    }
  }
})

const origin = 'http://127.0.0.1:5173'

async function loadApp() {
  const { createApp } = await import('../../apps/api/src/app.ts')
  const supertest = (await import('supertest')).default
  const app = createApp()
  return {
    agent: () => supertest.agent(app),
  }
}

function cookieValue(header: string | string[] | undefined, name: string): string {
  const rows = Array.isArray(header) ? header : header ? [header] : []
  const row = rows.find((item) => item.startsWith(`${name}=`))
  return row?.split(';')[0]?.slice(name.length + 1) ?? ''
}
