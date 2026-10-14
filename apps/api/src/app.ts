import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cookieParser from 'cookie-parser'
import express, { type NextFunction, type Request, type Response } from 'express'
import helmet from 'helmet'
import { prisma } from '@livebrary/database'
import { discordStatus, recordAudit } from '@livebrary/discord-logger'
import { config, originAllowed } from './config.js'
import { HttpError, clientIp, safeEqual, wrap } from './http.js'
import { gateFromRequest, userFromRequest } from './identity.js'
import type { Limiter } from './rate-limit.js'
import { createMemoryLimiter } from './rate-limit.js'
import { adminRouter } from './routes/admin.js'
import { authRouter } from './routes/auth.js'
import { chatRouter } from './routes/chat.js'
import { fileRouter } from './routes/files.js'
import { gateRouter } from './routes/gate.js'
import { memberRouter } from './routes/members.js'
import { oauthRouter } from './routes/oauth.js'
import { profileRouter } from './routes/profile.js'
import { projectRouter } from './routes/projects.js'
import { riyanRouter } from './routes/riyan.js'

function apiPath(req: Request): string {
  const path = (req.originalUrl || req.url || req.path).split('?')[0] ?? ''
  return path.startsWith('/api') ? path.slice(4) || '/' : path
}

export function createApp(limiter: Limiter = createMemoryLimiter()) {
  const app = express()
  app.set('trust proxy', 1)
  app.disable('x-powered-by')
  app.use(helmet({ contentSecurityPolicy: false }))
  app.use(express.json({ limit: '2mb' }))
  app.use(cookieParser())
  app.use('/api/integrations/riyan', riyanRouter(limiter))
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next()
    if (!originAllowed(req.get('origin'), req.get('host'))) {
      void suspicious(req, 'origin').finally(() => next(new HttpError(403, 'ORIGIN', '요청 출처가 거부되었습니다.')))
      return
    }
    if (apiPath(req) === '/gate/enter' || apiPath(req) === '/gate/admin') return next()
    const header = req.get('x-csrf-token') ?? ''
    const cookie = (req.cookies as Record<string, string | undefined>).lb_csrf ?? ''
    if (!header || !cookie || !safeEqual(header, cookie)) {
      void suspicious(req, 'csrf').finally(() => next(new HttpError(403, 'CSRF', '보안 토큰이 올바르지 않습니다.')))
      return
    }
    next()
  })

  // One audit row per IP and stage per 10 minutes, so a scripted flood cannot fill the audit log.
  async function suspicious(req: Request, stage: string) {
    const ip = clientIp(req)
    if (!(await limiter.hit(`suspicious:${stage}:${ip}`, 1, 10 * 60 * 1000))) return
    await recordAudit({ eventType: 'ACCESS_DENIED', result: 'DENIED', metadata: { stage, ip, path: apiPath(req).slice(0, 80) } }).catch(() => undefined)
  }

  app.get('/api/health', wrap(async (_req, res) => {
    let database = 'down'
    try {
      await prisma.$queryRaw`SELECT 1`
      database = 'up'
    } catch {
      database = 'down'
    }
    res.json({ ok: database === 'up', database, discord: discordStatus() })
  }))

  app.use('/api/gate', gateRouter(limiter))
  app.use('/api/oauth', oauthRouter(limiter))
  app.use('/api', wrap(async (req, _res, next) => {
    const gate = await gateFromRequest(req)
    if (!gate) throw new HttpError(401, 'GATE', '입장 세션이 필요합니다.')
    req.gateId = gate.id
    next()
  }))

  const auth = authRouter(limiter)
  app.use('/api/auth', auth)
  app.use('/api', wrap(async (req, _res, next) => {
    const relative = apiPath(req)
    if (relative === '/auth/register' || relative === '/auth/login') return next()
    const user = await userFromRequest(req)
    if (!user) throw new HttpError(401, 'UNAUTHORIZED', '로그인이 필요합니다.')
    if (user.status !== 'ACTIVE' && relative !== '/auth/logout' && !relative.startsWith('/admin')) {
      throw new HttpError(403, 'FORBIDDEN', '제한된 계정입니다.')
    }
    req.user = user
    next()
  }))
  app.use('/api', profileRouter())
  app.use('/api/projects', projectRouter())
  app.use('/api/projects/:id/files', fileRouter())
  app.use('/api', memberRouter())
  app.use('/api', chatRouter())
  app.use('/api/admin', adminRouter(limiter))

  if (config.serveWeb) {
    const dist = fileURLToPath(new URL('../../web/dist', import.meta.url))
    if (existsSync(path.join(dist, 'index.html'))) {
      app.use(express.static(dist, { index: false, maxAge: config.isProduction ? '1h' : 0 }))
      app.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next()
        if (req.path.startsWith('/api')) return next()
        res.setHeader('Cache-Control', 'no-cache')
        res.sendFile(path.join(dist, 'index.html'), (error) => {
          if (error) next(error)
        })
      })
    }
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } })
      return
    }
    console.error(error instanceof Error ? error.message : 'request failed')
    res.status(500).json({ error: { code: 'INTERNAL', message: '요청을 처리하지 못했습니다.' } })
  })
  return app
}
