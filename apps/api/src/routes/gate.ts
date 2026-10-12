import { Router } from 'express'
import { recordAudit } from '@livebrary/discord-logger'
import { matchAdminPhrase, normalizePhrase } from '../admin-phrase.js'
import { PRE_ADMIN_MS, issuePreAdmin } from '../challenges.js'
import { config } from '../config.js'
import { clientIp, userAgent, wrap } from '../http.js'
import { clearGateCookie, gateFromRequest, issueGate } from '../identity.js'
import type { Limiter } from '../rate-limit.js'

export function gateRouter(limiter: Limiter): Router {
  const router = Router()

  router.get('/status', wrap(async (req, res) => {
    const gate = await gateFromRequest(req)
    res.json({ active: Boolean(gate), expiresAt: gate?.expiresAt ?? null })
  }))

  router.post('/enter', wrap(async (req, res) => {
    const allowed = await limiter.hit(`gate:${clientIp(req)}`, 30, 60 * 60 * 1000)
    if (!allowed) {
      await recordAudit({ eventType: 'GATE_FAILED', result: 'DENIED', metadata: { ip: clientIp(req), reason: 'rate limit' } })
      res.status(429).json({ error: { code: 'RATE_LIMIT', message: '입장 요청이 너무 많습니다.' } })
      return
    }
    await issueGate(req, res, clientIp(req), userAgent(req))
    await recordAudit({ eventType: 'GATE_ENTERED', result: 'SUCCESS', metadata: { ip: clientIp(req) } })
    res.json({ ok: true })
  }))

  router.post('/admin', wrap(async (req, res) => {
    const ip = clientIp(req)
    const allowed = await limiter.hit(`gate-admin:${ip}`, 5, 15 * 60 * 1000)
    if (!allowed) {
      await recordAudit({ eventType: 'ADMIN_ACCESS_DENIED', result: 'DENIED', metadata: { ip, stage: 'gate', reason: 'rate limit' } })
      res.status(429).json({ error: { code: 'RATE_LIMIT', message: 'Too many attempts' } })
      return
    }
    const phrase = normalizePhrase((req.body as { phrase?: unknown }).phrase)
    const via = phrase ? await matchAdminPhrase(phrase) : null
    if (!via) {
      await recordAudit({ eventType: 'ADMIN_ACCESS_DENIED', result: 'FAILURE', metadata: { ip, stage: 'gate' } })
      res.status(401).json({ error: { code: 'REJECTED', message: 'Rejected' } })
      return
    }
    await issueGate(req, res, ip, userAgent(req))
    res.cookie('lb_admin_pre', issuePreAdmin(via), {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: 'strict',
      path: '/api/admin',
      maxAge: PRE_ADMIN_MS,
    })
    await recordAudit({ eventType: 'ADMIN_CODE_ACCEPTED', result: 'SUCCESS', metadata: { ip, stage: 'gate', via } })
    res.json({ ok: true })
  }))

  router.post('/exit', wrap(async (req, res) => {
    clearGateCookie(res)
    res.json({ ok: true })
  }))

  return router
}
