import { Router, type Request } from 'express'
import { prisma } from '@livebrary/database'
import { hashSecret } from '@livebrary/database/password'
import { recordAudit } from '@livebrary/discord-logger'
import { nextWeekStart, weekStart } from '@livebrary/shared'
import { RIYAN_CODE_KEY, normalizePhrase, type RiyanCode } from '../admin-phrase.js'
import { config } from '../config.js'
import { HttpError, clientIp, safeEqual, wrap } from '../http.js'
import type { Limiter } from '../rate-limit.js'

/** Server-to-server routes used by the Riyan Discord bot. */
export function riyanRouter(limiter: Limiter): Router {
  const router = Router()

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

  // Without a cursor this returns only the newest account as the starting point, so the bot never replays old signups.
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

  return router
}
