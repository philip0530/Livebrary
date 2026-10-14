import { Router, type Request } from 'express'
import { prisma } from '@livebrary/database'
import { sha256 } from '@livebrary/database/crypto'
import { hashSecret } from '@livebrary/database/password'
import { recordAudit } from '@livebrary/discord-logger'
import { nextWeekStart, weekStart } from '@livebrary/shared'
import { RIYAN_CODE_KEY, normalizePhrase, type RiyanCode } from '../admin-phrase.js'
import { config } from '../config.js'
import { HttpError, clientIp, safeEqual, wrap } from '../http.js'
import type { Limiter } from '../rate-limit.js'

/**
 * 리얀 디스코드 봇 전용 서버 간 API.
 * 봇은 사용자 PC에서 돌기 때문에 Render가 봇에 접속할 수 없어, 항상 봇이 이쪽으로 요청(폴링)합니다.
 */
export function riyanRouter(limiter: Limiter): Router {
  const router = Router()

  // 요청 횟수 제한 + 동기화 키(x-livebrary-sync-key) 확인. 키가 틀리면 보안 로그에 남습니다.
  async function authorize(req: Request, bucket: string, max: number) {
    const ip = clientIp(req)
    if (!(await limiter.hit(`${bucket}:${ip}`, max, 15 * 60 * 1000))) throw new HttpError(429, 'RATE_LIMIT', 'Too many requests')
    const key = req.get('x-livebrary-sync-key') ?? ''
    if (!config.riyanSyncKey || !key || !safeEqual(key, config.riyanSyncKey)) {
      await recordAudit({ eventType: 'ADMIN_ACCESS_DENIED', result: 'DENIED', metadata: { ip, stage: bucket } })
      throw new HttpError(401, 'UNAUTHORIZED', 'Unauthorized')
    }
  }

  router.post('/admin-code', wrap(async (req, res) => {
    await authorize(req, 'riyan-sync', 30)
    const body = req.body as { weekStart?: unknown; code?: unknown }
    const code = normalizePhrase(body.code)
    const start = weekStart()
    if (!code || code.length < 8) throw new HttpError(400, 'VALIDATION', 'Invalid code')
    const mondayKst = new Date(start.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
    if (body.weekStart !== mondayKst) throw new HttpError(409, 'WEEK_MISMATCH', 'Week does not match the server week')
    const value: RiyanCode = {
      weekStart: start.toISOString(),
      expiresAt: nextWeekStart(start).toISOString(),
      codeHash: await hashSecret(code),
    }
    await prisma.serviceSetting.upsert({
      where: { key: RIYAN_CODE_KEY },
      update: { value: JSON.stringify(value) },
      create: { key: RIYAN_CODE_KEY, value: JSON.stringify(value) },
    })
    await recordAudit({
      eventType: 'ADMIN_CODE_ROTATED',
      result: 'SUCCESS',
      resourceType: 'admin-code',
      metadata: { weekStart: value.weekStart, source: 'riyan' },
    })
    res.json({ ok: true, weekStart: value.weekStart, expiresAt: value.expiresAt })
  }))

  // 새 가입자 목록 (디스코드 가입 알림용). after/afterId 커서 이후의 가입자만 돌려줍니다.
  // 커서 없이 처음 호출하면 가장 최근 가입자를 시작점으로만 알려 주어, 예전 가입자를 다시 알리지 않습니다.
  router.get('/registrations', wrap(async (req, res) => {
    await authorize(req, 'riyan-poll', 120)
    const afterRaw = typeof req.query.after === 'string' ? req.query.after : ''
    const afterId = typeof req.query.afterId === 'string' ? req.query.afterId.slice(0, 64) : ''
    const after = afterRaw ? new Date(afterRaw) : null
    if (after && Number.isNaN(after.getTime())) throw new HttpError(400, 'VALIDATION', 'Invalid cursor')
    const select = { id: true, username: true, createdAt: true } as const
    const users = after
      ? await prisma.user.findMany({
          where: { OR: [{ createdAt: { gt: after } }, { createdAt: after, id: { gt: afterId } }] },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 25,
          select,
        })
      : []
    const last = users.at(-1) ?? (after ? null : await prisma.user.findFirst({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select }))
    res.json({
      users: users.map((u) => ({ id: u.id, username: u.username, createdAt: u.createdAt.toISOString() })),
      cursor: last ? { after: last.createdAt.toISOString(), afterId: last.id } : { after: after?.toISOString() ?? new Date(0).toISOString(), afterId },
      total: await prisma.user.count(),
    })
  }))

  // 디스코드 서버에서 /인증 코드를 입력하면 봇이 호출합니다. 가입 대기 행을 "인증됨"으로 표시만 하고,
  // 실제 계정 생성은 브라우저의 /register/complete 가 합니다.
  // 404: 이 사이트의 가입 코드가 아님 (봇은 다른 사이트나 기존 계정 연결 코드로 넘어감)
  router.post('/registration-verify', wrap(async (req, res) => {
    await authorize(req, 'riyan-verify', 300)
    const body = req.body as { code?: unknown; discordUserId?: unknown; discordName?: unknown }
    const code = typeof body.code === 'string' ? body.code.replace(/[\s-]/g, '').toUpperCase() : ''
    const discordUserId = typeof body.discordUserId === 'string' && /^\d{5,25}$/.test(body.discordUserId) ? body.discordUserId : ''
    const discordName = typeof body.discordName === 'string' ? body.discordName.slice(0, 64) : ''
    if (!/^[A-Z2-9]{10}$/.test(code) || !discordUserId) throw new HttpError(400, 'VALIDATION', 'Invalid code')
    const pending = await prisma.pendingRegistration.findUnique({ where: { codeHash: sha256(code) } })
    if (!pending || pending.expiresAt <= new Date()) throw new HttpError(404, 'NOT_FOUND', 'Unknown code')
    // 다른 디스코드 사용자가 이미 쓴 코드 / 이미 Livebrary 계정이 있는 디스코드 계정은 거부 (1 디스코드 = 1 계정)
    if (pending.verifiedAt && pending.discordUserId !== discordUserId) throw new HttpError(409, 'CONFLICT', 'Code already used')
    if (await prisma.user.findUnique({ where: { discordUserId } })) {
      throw new HttpError(409, 'DISCORD_TAKEN', 'This Discord account is already linked')
    }
    await prisma.pendingRegistration.update({
      where: { id: pending.id },
      data: { verifiedAt: new Date(), discordUserId, discordName },
    })
    res.json({ ok: true, username: pending.username })
  }))

  // 이상 행동 목록 (디스코드 보안 채널용). 감사 로그 중 결과가 SUCCESS가 아닌 것
  // (로그인 실패, 권한 없는 접근, CSRF/출처 위반, 잘못된 봇 키 등)을 커서 이후로 최대 50건 돌려줍니다.
  router.get('/security-events', wrap(async (req, res) => {
    await authorize(req, 'riyan-poll-security', 120)
    const afterRaw = typeof req.query.after === 'string' ? req.query.after : ''
    const afterId = typeof req.query.afterId === 'string' ? req.query.afterId.slice(0, 64) : ''
    const after = afterRaw ? new Date(afterRaw) : null
    if (after && Number.isNaN(after.getTime())) throw new HttpError(400, 'VALIDATION', 'Invalid cursor')
    const where = { result: { not: 'SUCCESS' as const } }
    const rows = after
      ? await prisma.auditLog.findMany({
          where: { ...where, OR: [{ createdAt: { gt: after } }, { createdAt: after, id: { gt: afterId } }] },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 50,
          include: { actor: { select: { username: true } } },
        })
      : []
    const last = rows.at(-1) ?? (after ? null : await prisma.auditLog.findFirst({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }))
    res.json({
      events: rows.map((row) => {
        const meta = (row.metadata ?? {}) as Record<string, unknown>
        return {
          id: row.id,
          eventType: row.eventType,
          result: row.result,
          createdAt: row.createdAt.toISOString(),
          username: row.actor?.username ?? null,
          ip: typeof meta.ip === 'string' ? meta.ip : null,
          email: typeof meta.email === 'string' ? maskEmail(meta.email) : null,
          detail: [meta.stage, meta.reason, meta.path].filter((value) => typeof value === 'string').join(' · ').slice(0, 120),
        }
      }),
      cursor: last ? { after: last.createdAt.toISOString(), afterId: last.id } : { after: after?.toISOString() ?? new Date(0).toISOString(), afterId },
    })
  }))

  return router
}

// 디스코드에 올라가는 값이라 이메일은 앞 2글자만 보이게 가립니다. (예: ab***@gmail.com)
function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@')
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`
}
