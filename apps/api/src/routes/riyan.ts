import { Router } from 'express'
import { prisma } from '@livebrary/database'
import { hashSecret } from '@livebrary/database/password'
import { recordAudit } from '@livebrary/discord-logger'
import { nextWeekStart, weekStart } from '@livebrary/shared'
import { RIYAN_CODE_KEY, normalizePhrase, type RiyanCode } from '../admin-phrase.js'
import { config } from '../config.js'
import { HttpError, clientIp, safeEqual, wrap } from '../http.js'
import type { Limiter } from '../rate-limit.js'

/** Server-to-server: Riyan bot pushes the weekly admin code it posted to Discord. */
export function riyanRouter(limiter: Limiter): Router {
  const router = Router()

  router.post('/admin-code', wrap(async (req, res) => {
    const ip = clientIp(req)
    if (!(await limiter.hit(`riyan-sync:${ip}`, 30, 15 * 60 * 1000))) throw new HttpError(429, 'RATE_LIMIT', 'Too many requests')
    const key = req.get('x-livebrary-sync-key') ?? ''
    if (!config.riyanSyncKey || !key || !safeEqual(key, config.riyanSyncKey)) {
      await recordAudit({ eventType: 'ADMIN_ACCESS_DENIED', result: 'DENIED', metadata: { ip, stage: 'riyan-sync' } })
      throw new HttpError(401, 'UNAUTHORIZED', 'Unauthorized')
    }
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

  return router
}
