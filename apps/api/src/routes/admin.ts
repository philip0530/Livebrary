import { Router, type Request } from 'express'
import { prisma } from '@livebrary/database'
import { sha256 } from '@livebrary/database/crypto'
import { hashSecret } from '@livebrary/database/password'
import {
  discordStatus,
  queueDepth,
  recordAudit,
  reissueWeeklyCode,
  runtime,
  sendTestMessage,
} from '@livebrary/discord-logger'
import { weekStart } from '@livebrary/shared'
import { matchAdminPhrase, normalizePhrase } from '../admin-phrase.js'
import { clearChallenge, getChallenge, pollDiscordApproval, redeemPreAdmin, setChallenge, startDiscordApproval } from '../challenges.js'
import { discordAuthorizeUrl, discordOAuthConfigured } from '../discord-oauth.js'
import { adminFromRequest, issueAdminSession, revokeAdminToken } from '../identity.js'
import { HttpError, routeParam, wrap } from '../http.js'
import type { Limiter } from '../rate-limit.js'

function sessionKey(req: Request): string {
  return sha256((req.cookies as Record<string, string | undefined>).lb_session ?? '')
}

export function adminRouter(limiter: Limiter): Router {
  const router = Router()

  router.post('/access/continue', wrap(async (req, res) => {
    const user = req.user!
    const via = redeemPreAdmin((req.cookies as Record<string, string | undefined>).lb_admin_pre)
    res.clearCookie('lb_admin_pre', { path: '/api/admin' })
    if (!via) {
      await recordAudit({ eventType: 'ADMIN_ACCESS_DENIED', actorId: user.id, result: 'DENIED', metadata: { username: user.username, stage: 'login', reason: 'no gate code' } })
      throw new HttpError(401, 'REJECTED', 'ACCESS DENIED')
    }
    if (user.systemRole !== 'SYSTEM_ADMIN') {
      await recordAudit({ eventType: 'ADMIN_ACCESS_DENIED', actorId: user.id, result: 'DENIED', metadata: { username: user.username, stage: 'login', reason: 'not admin' } })
      throw new HttpError(403, 'REJECTED', 'ACCESS DENIED')
    }
    setChallenge(user.id, via)
    res.json({ accepted: true })
  }))

  router.post('/access-code', wrap(async (req, res) => {
    const user = req.user!
    const challenge = getChallenge(user.id)
    if (user.systemRole !== 'SYSTEM_ADMIN' || !challenge) throw new HttpError(401, 'CHALLENGE', '입장 확인이 만료되었습니다. 검은 화면에서 다시 시작하세요.')
    const allowed = await limiter.hit(`admin-code-confirm:${user.id}`, 5, 15 * 60 * 1000)
    if (!allowed) throw new HttpError(429, 'RATE_LIMIT', '시도가 너무 많습니다.')
    const phrase = normalizePhrase((req.body as { code?: unknown }).code)
    const via = phrase ? await matchAdminPhrase(phrase) : null
    if (!via) {
      await recordAudit({ eventType: 'ADMIN_ACCESS_DENIED', actorId: user.id, result: 'FAILURE', metadata: { username: user.username, stage: 'code' } })
      throw new HttpError(401, 'REJECTED', '코드가 올바르지 않습니다.')
    }
    const expiresAt = await issueAdminSession(res, user.id)
    clearChallenge(user.id)
    await recordAudit({
      eventType: via === 'fallback' ? 'ADMIN_FALLBACK_USED' : 'ADMIN_ENTRY',
      actorId: user.id,
      result: 'SUCCESS',
      resourceType: 'admin-session',
      metadata: { username: user.username, factor: 'code', via },
    })
    res.json({ ok: true, expiresAt })
  }))

  router.post('/discord-auth/start', wrap(async (req, res) => {
    const user = req.user!
    if (user.systemRole !== 'SYSTEM_ADMIN' || !getChallenge(user.id)) throw new HttpError(401, 'CHALLENGE', '입장 확인이 만료되었습니다. 검은 화면에서 다시 시작하세요.')
    if (!discordOAuthConfigured()) throw new HttpError(503, 'DISCORD_NOT_CONFIGURED', 'Discord OAuth가 설정되지 않았습니다. DISCORD_CLIENT_ID와 DISCORD_CLIENT_SECRET을 확인하세요.')
    if (!user.discordUserId) throw new HttpError(409, 'DISCORD_NOT_LINKED', '연결된 Discord 계정이 없습니다.')
    const allowed = await limiter.hit(`admin-discord:${user.id}`, 10, 15 * 60 * 1000)
    if (!allowed) throw new HttpError(429, 'RATE_LIMIT', 'QR 요청이 너무 많습니다.')
    const { state, expiresAt } = startDiscordApproval(user.id, sessionKey(req))
    res.json({ authorizeUrl: discordAuthorizeUrl(state), expiresAt })
  }))

  router.post('/discord-auth/poll', wrap(async (req, res) => {
    const user = req.user!
    if (user.systemRole !== 'SYSTEM_ADMIN') throw new HttpError(404, 'UNKNOWN', 'Not found')
    const status = pollDiscordApproval(user.id, sessionKey(req))
    if (status !== 'approved') {
      res.json({ status })
      return
    }
    const challenge = getChallenge(user.id)
    if (!challenge) {
      clearChallenge(user.id)
      res.json({ status: 'expired' })
      return
    }
    const expiresAt = await issueAdminSession(res, user.id)
    clearChallenge(user.id)
    await recordAudit({
      eventType: challenge.via === 'fallback' ? 'ADMIN_FALLBACK_USED' : 'ADMIN_ENTRY',
      actorId: user.id,
      result: 'SUCCESS',
      resourceType: 'admin-session',
      metadata: { username: user.username, factor: 'discord' },
    })
    res.json({ status: 'approved', expiresAt })
  }))

  router.use(wrap(async (req, _res, next) => {
    const admin = await adminFromRequest(req)
    if (!admin) throw new HttpError(401, 'ADMIN', '관리자 세션이 필요합니다.')
    req.user = admin
    next()
  }))

  router.post('/exit', wrap(async (req, res) => {
    await revokeAdminToken((req.cookies as Record<string, string | undefined>).lb_admin)
    res.clearCookie('lb_admin', { path: '/' })
    await recordAudit({ eventType: 'ADMIN_EXIT', actorId: req.user!.id, result: 'SUCCESS', metadata: { username: req.user!.username } })
    res.json({ ok: true })
  }))

  router.get('/dashboard', wrap(async (_req, res) => {
    const [users, projects, sessions, limited, queue, database] = await Promise.all([
      prisma.user.count(),
      prisma.project.count(),
      prisma.userSession.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
      prisma.user.count({ where: { status: 'LIMITED' } }),
      queueDepth(),
      prisma.$queryRaw`SELECT 1`.then(() => 'up').catch(() => 'down'),
    ])
    const code = await prisma.adminAccessCode.findUnique({ where: { weekStart: weekStart() } })
    res.json({
      users,
      projects,
      activeSessions: sessions,
      limitedUsers: limited,
      database,
      websocket: { connections: runtime.websocketConnections },
      discord: discordStatus(),
      queue,
      weeklyCode: {
        active: code?.status === 'ACTIVE',
        published: Boolean(code?.publishedAt),
        publishError: code?.publishError ?? '',
        expiresAt: code?.expiresAt ?? null,
      },
    })
  }))

  router.get('/users', wrap(async (req, res) => {
    const q = String(req.query.q ?? '').trim()
    const users = await prisma.user.findMany({
      where: q ? { OR: [{ username: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        email: true,
        username: true,
        systemRole: true,
        status: true,
        createdAt: true,
        _count: { select: { sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } } } } },
      },
    })
    res.json({
      users: users.map((user) => ({ ...user, sessionCount: user._count.sessions, _count: undefined })),
    })
  }))

  router.post('/users/:id/limit', wrap(async (req, res) => {
    if ((req.body as { confirm?: boolean }).confirm !== true) throw new HttpError(400, 'CONFIRM', '확인이 필요합니다.')
    const user = await prisma.user.findUnique({ where: { id: routeParam(req.params.id) } })
    if (!user) throw new HttpError(404, 'NOT_FOUND', '사용자를 찾을 수 없습니다.')
    if (user.id === req.user!.id || user.systemRole === 'SYSTEM_ADMIN') {
      throw new HttpError(400, 'VALIDATION', '시스템 관리자 계정은 이 화면에서 제한할 수 없습니다.')
    }
    const limited = (req.body as { limited?: boolean }).limited !== false
    await prisma.user.update({ where: { id: user.id }, data: { status: limited ? 'LIMITED' : 'ACTIVE' } })
    if (limited) {
      await prisma.userSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } })
    }
    await recordAudit({
      eventType: limited ? 'ACCOUNT_LIMITED' : 'ACCOUNT_UNLIMITED',
      actorId: req.user!.id,
      resourceType: 'user',
      resourceId: user.id,
      result: 'SUCCESS',
      metadata: { username: user.username },
    })
    res.json({ ok: true })
  }))

  router.post('/users/:id/revoke-sessions', wrap(async (req, res) => {
    if ((req.body as { confirm?: boolean }).confirm !== true) throw new HttpError(400, 'CONFIRM', '확인이 필요합니다.')
    const user = await prisma.user.findUnique({ where: { id: routeParam(req.params.id) } })
    if (!user) throw new HttpError(404, 'NOT_FOUND', '사용자를 찾을 수 없습니다.')
    if (user.id === req.user!.id) throw new HttpError(400, 'VALIDATION', '현재 관리자 세션은 종료 명령으로 닫으세요.')
    await prisma.userSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } })
    await prisma.adminSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } })
    await recordAudit({
      eventType: 'SESSIONS_REVOKED',
      actorId: req.user!.id,
      resourceType: 'user',
      resourceId: user.id,
      result: 'SUCCESS',
      metadata: { username: user.username },
    })
    res.json({ ok: true })
  }))

  router.get('/projects', wrap(async (_req, res) => {
    const projects = await prisma.project.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: { owner: { select: { username: true } }, _count: { select: { members: true } } },
    })
    res.json({
      projects: projects.map((project) => ({
        id: project.id,
        name: project.name,
        visibility: project.visibility,
        owner: project.owner.username,
        memberCount: project._count.members,
        updatedAt: project.updatedAt,
      })),
    })
  }))

  router.get('/security', wrap(async (_req, res) => {
    const events = await prisma.auditLog.findMany({
      where: {
        OR: [
          { result: { in: ['FAILURE', 'DENIED'] } },
          { eventType: { in: ['ADMIN_ENTRY', 'ADMIN_FALLBACK_USED', 'ACCOUNT_LIMITED', 'SESSIONS_REVOKED'] } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { actor: { select: { username: true } } },
    })
    res.json({ events })
  }))

  router.get('/audit-logs', wrap(async (req, res) => {
    const before = typeof req.query.before === 'string' ? new Date(req.query.before) : null
    const logs = await prisma.auditLog.findMany({
      where: before && !Number.isNaN(before.getTime()) ? { createdAt: { lt: before } } : {},
      orderBy: { createdAt: 'desc' },
      take: 80,
      include: { actor: { select: { username: true } }, project: { select: { name: true } } },
    })
    res.json({ logs })
  }))

  router.get('/discord/settings', wrap(async (_req, res) => {
    const rows = await prisma.serviceSetting.findMany()
    const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]))
    res.json({
      settings: {
        activityChannelId: settings['discord.activityChannelId'] ?? process.env.DISCORD_ACTIVITY_CHANNEL_ID ?? '',
        securityChannelId: settings['discord.securityChannelId'] ?? process.env.DISCORD_SECURITY_CHANNEL_ID ?? '',
        developerCodeChannelId: settings['discord.developerCodeChannelId'] ?? process.env.DISCORD_DEVELOPER_CODE_CHANNEL_ID ?? '',
      },
      status: discordStatus(),
    })
  }))

  router.patch('/discord/settings', wrap(async (req, res) => {
    const body = req.body as Record<string, unknown>
    const pairs: [string, unknown][] = [
      ['discord.activityChannelId', body.activityChannelId],
      ['discord.securityChannelId', body.securityChannelId],
      ['discord.developerCodeChannelId', body.developerCodeChannelId],
    ]
    for (const [key, value] of pairs) {
      if (value === undefined) continue
      if (typeof value !== 'string' || (value !== '' && !/^\d{5,30}$/.test(value))) {
        throw new HttpError(400, 'VALIDATION', 'Discord 채널 ID는 숫자여야 합니다.')
      }
      await prisma.serviceSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
    }
    await recordAudit({
      eventType: 'ADMIN_SETTINGS_CHANGED',
      actorId: req.user!.id,
      result: 'SUCCESS',
      metadata: { source: 'discord-settings', username: req.user!.username },
    })
    res.json({ ok: true })
  }))

  router.post('/discord/test', wrap(async (_req, res) => {
    await sendTestMessage()
    res.json({ ok: true })
  }))

  router.get('/discord/status', wrap(async (_req, res) => {
    const code = await prisma.adminAccessCode.findUnique({ where: { weekStart: weekStart() } })
    res.json({
      discord: discordStatus(),
      queue: await queueDepth(),
      weeklyCode: {
        active: code?.status === 'ACTIVE',
        published: Boolean(code?.publishedAt),
        publishError: code?.publishError ?? '',
        publishAttempts: code?.publishAttempts ?? 0,
        expiresAt: code?.expiresAt ?? null,
      },
    })
  }))

  router.post('/fallback/rotate', wrap(async (req, res) => {
    if ((req.body as { confirm?: boolean }).confirm !== true) throw new HttpError(400, 'CONFIRM', '확인이 필요합니다.')
    const code = String((req.body as { code?: string }).code ?? '').trim()
    if (code.length < 4 || code.length > 64 || /\s/.test(code)) {
      throw new HttpError(400, 'VALIDATION', '예비 코드는 공백 없는 4~64자여야 합니다.')
    }
    await prisma.adminFallbackCredential.updateMany({ where: { isActive: true }, data: { isActive: false } })
    await prisma.adminFallbackCredential.create({
      data: { codeHash: await hashSecret(code.toLowerCase()), isActive: true, updatedById: req.user!.id },
    })
    await recordAudit({
      eventType: 'ADMIN_FALLBACK_ROTATED',
      actorId: req.user!.id,
      result: 'SUCCESS',
      metadata: { username: req.user!.username },
    })
    res.json({ ok: true })
  }))

  router.post('/access-code/reissue', wrap(async (req, res) => {
    if ((req.body as { confirm?: boolean }).confirm !== true) throw new HttpError(400, 'CONFIRM', '확인이 필요합니다.')
    await reissueWeeklyCode()
    res.json({ ok: true })
  }))

  return router
}
