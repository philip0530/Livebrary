import { Router, type Response } from 'express'
import { prisma } from '@livebrary/database'
import { recordAudit } from '@livebrary/discord-logger'
import { pendingDiscordApproval, settleDiscordApproval } from '../challenges.js'
import { exchangeDiscordCode } from '../discord-oauth.js'
import { clientIp, wrap } from '../http.js'
import type { Limiter } from '../rate-limit.js'

type Outcome = 'approved' | 'denied' | 'expired' | 'error'

const PAGES: Record<Outcome, { title: string; line: string; color: string }> = {
  approved: { title: '[OK] ADMIN LOGIN APPROVED', line: '컴퓨터 화면으로 돌아가세요. 관리자 콘솔이 자동으로 열립니다.', color: '#7bd88f' },
  denied: { title: '[DENIED] ACCOUNT MISMATCH', line: '이 Discord 계정은 해당 관리자 계정에 연결되어 있지 않습니다.', color: '#ff6b6b' },
  expired: { title: '[EXPIRED] QR NO LONGER VALID', line: '컴퓨터에서 새 QR을 띄운 뒤 다시 찍어 주세요.', color: '#f4c76b' },
  error: { title: '[ERROR] DISCORD UNAVAILABLE', line: 'Discord 확인에 실패했습니다. 잠시 뒤 새 QR로 다시 시도하세요.', color: '#ff6b6b' },
}

function page(res: Response, outcome: Outcome): void {
  const { title, line, color } = PAGES[outcome]
  res.status(outcome === 'approved' ? 200 : outcome === 'expired' ? 410 : 403)
  res.setHeader('Cache-Control', 'no-store')
  res.type('html').send(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Livebrary</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#d4d4d4;font:14px/1.6 Consolas,'Cascadia Code',monospace">
<main style="border:1px solid #293629;padding:24px 28px;max-width:420px;margin:16px"><div style="color:#7f8c7f;letter-spacing:.2em;font-size:12px">LIVEBRARY · ADMIN</div>
<h1 style="font-size:16px;font-weight:400;color:${color};margin:12px 0">${title}</h1><p style="margin:0">${line}</p></main></body></html>`)
}

export function oauthRouter(limiter: Limiter): Router {
  const router = Router()

  router.get('/discord/callback', wrap(async (req, res) => {
    const ip = clientIp(req)
    if (!(await limiter.hit(`oauth-discord:${ip}`, 20, 15 * 60 * 1000))) {
      page(res, 'expired')
      return
    }
    const state = typeof req.query.state === 'string' ? req.query.state : undefined
    const code = typeof req.query.code === 'string' ? req.query.code : undefined
    const approval = pendingDiscordApproval(state)
    if (!state || !approval) {
      page(res, 'expired')
      return
    }
    const user = await prisma.user.findUnique({ where: { id: approval.userId }, select: { id: true, username: true, discordUserId: true, systemRole: true, status: true } })
    if (!user || user.systemRole !== 'SYSTEM_ADMIN' || user.status !== 'ACTIVE' || !user.discordUserId) {
      settleDiscordApproval(state, 'denied')
      page(res, 'denied')
      return
    }
    if (!code) {
      settleDiscordApproval(state, 'denied')
      await recordAudit({ eventType: 'ADMIN_MFA_FAILED', actorId: user.id, result: 'DENIED', metadata: { username: user.username, factor: 'discord', reason: 'cancelled', ip } })
      page(res, 'denied')
      return
    }
    let discordId: string
    try {
      discordId = await exchangeDiscordCode(code)
    } catch (error) {
      settleDiscordApproval(state, 'denied')
      await recordAudit({ eventType: 'ADMIN_MFA_FAILED', actorId: user.id, result: 'FAILURE', metadata: { username: user.username, factor: 'discord', reason: error instanceof Error ? error.message.slice(0, 120) : 'exchange failed', ip } })
      page(res, 'error')
      return
    }
    if (discordId !== user.discordUserId) {
      settleDiscordApproval(state, 'denied')
      await recordAudit({ eventType: 'ADMIN_MFA_FAILED', actorId: user.id, result: 'DENIED', metadata: { username: user.username, factor: 'discord', reason: 'discord account mismatch', ip } })
      page(res, 'denied')
      return
    }
    settleDiscordApproval(state, 'approved')
    await recordAudit({ eventType: 'ADMIN_DISCORD_APPROVED', actorId: user.id, result: 'SUCCESS', metadata: { username: user.username, ip } })
    page(res, 'approved')
  }))

  return router
}
