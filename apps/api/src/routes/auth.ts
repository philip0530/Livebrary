import { randomInt } from 'node:crypto'
import { Router } from 'express'
import { prisma } from '@livebrary/database'
import { randomToken, sha256 } from '@livebrary/database/crypto'
import { hashSecret, verifySecret } from '@livebrary/database/password'
import { config } from '../config.js'
import { recordAudit } from '@livebrary/discord-logger'
import { validateEmail, validatePassword, validateUsername } from '@livebrary/shared'
import { HttpError, clientIp, userAgent, wrap } from '../http.js'
import {
  clearAuthCookies,
  clearGateCookie,
  ensureCsrf,
  revokeGateToken,
  issueSession,
  publicUser,
  revokeAdminToken,
  revokeSessionToken,
  userFromRequest,
} from '../identity.js'
import type { Limiter } from '../rate-limit.js'

const SIGNUP_MS = 30 * 60 * 1000
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Same 10-character alphabet the Riyan bot's /인증 command accepts. */
export function signupCode(): string {
  return Array.from({ length: 10 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')
}

async function assertAvailable(email: string, username: string) {
  if (await prisma.user.findUnique({ where: { email } })) throw new HttpError(409, 'CONFLICT', '이미 사용 중인 이메일입니다.')
  if (await prisma.user.findUnique({ where: { usernameNormalized: username.toLowerCase() } })) {
    throw new HttpError(409, 'CONFLICT', '이미 사용 중인 사용자 이름입니다.')
  }
}

async function createUser(input: { email: string; username: string; passwordHash: string; discordUserId: string | null; discordName?: string | null }) {
  return prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: input.email,
        username: input.username,
        usernameNormalized: input.username.toLowerCase(),
        passwordHash: input.passwordHash,
        systemRole: 'USER',
        discordUserId: input.discordUserId,
        discordLinkedAt: input.discordUserId ? new Date() : null,
        preference: { create: {} },
      },
    })
    await recordAudit({
      eventType: 'USER_REGISTERED',
      actorId: created.id,
      resourceType: 'user',
      resourceId: created.id,
      result: 'SUCCESS',
      metadata: { username: input.username, discord: input.discordName ?? undefined },
    }, tx)
    return created
  })
}

export function authRouter(limiter: Limiter): Router {
  const router = Router()

  router.use(wrap(async (req, _res, next) => {
    req.user = (await userFromRequest(req)) ?? undefined
    next()
  }))

  router.get('/me', wrap(async (req, res) => {
    if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', '로그인이 필요합니다.')
    ensureCsrf(req, res)
    const preference = await prisma.userPreference.upsert({
      where: { userId: req.user.id },
      update: {},
      create: { userId: req.user.id },
    })
    res.json({ user: publicUser(req.user), preference })
  }))

  router.post('/register', wrap(async (req, res) => {
    const body = req.body as { email?: string; username?: string; password?: string; passwordConfirm?: string }
    const email = body.email?.trim().toLowerCase() ?? ''
    const username = body.username?.trim() ?? ''
    const password = body.password ?? ''
    const emailError = validateEmail(email)
    const usernameError = validateUsername(username)
    const passwordError = validatePassword(password, email, username)
    if (emailError || usernameError || passwordError) {
      throw new HttpError(400, 'VALIDATION', emailError ?? usernameError ?? passwordError ?? '입력값을 확인하세요.')
    }
    if (password !== (body.passwordConfirm ?? '')) throw new HttpError(400, 'VALIDATION', '비밀번호가 일치하지 않습니다.')
    const allowed = await limiter.hit(`register:${clientIp(req)}`, 5, 60 * 60 * 1000)
    if (!allowed) {
      await recordAudit({ eventType: 'ACCESS_DENIED', result: 'DENIED', metadata: { stage: 'register-rate-limit', ip: clientIp(req), email } })
      throw new HttpError(429, 'RATE_LIMIT', '회원가입 요청이 너무 많습니다.')
    }
    await assertAvailable(email, username)
    const passwordHash = await hashSecret(password)
    if (!config.requireDiscordSignup) {
      const user = await createUser({ email, username, passwordHash, discordUserId: null })
      await issueSession(res, user.id, clientIp(req), userAgent(req))
      ensureCsrf(req, res)
      res.status(201).json({ user: publicUser(user) })
      return
    }
    await prisma.pendingRegistration.deleteMany({ where: { OR: [{ email }, { expiresAt: { lt: new Date() } }] } })
    const token = randomToken()
    const code = signupCode()
    const expiresAt = new Date(Date.now() + SIGNUP_MS)
    await prisma.pendingRegistration.create({
      data: { email, username, usernameNormalized: username.toLowerCase(), passwordHash, tokenHash: sha256(token), codeHash: sha256(code), expiresAt },
    })
    res.status(202).json({ pending: { token, code, expiresAt: expiresAt.toISOString() } })
  }))

  // The Riyan bot marks the pending row verified once the code is entered inside the Livebrary Discord server.
  router.post('/register/complete', wrap(async (req, res) => {
    const token = String((req.body as { token?: unknown }).token ?? '')
    if (!token || token.length > 128) throw new HttpError(400, 'VALIDATION', '가입 정보가 올바르지 않습니다.')
    const allowed = await limiter.hit(`register-poll:${clientIp(req)}`, 600, 60 * 60 * 1000)
    if (!allowed) throw new HttpError(429, 'RATE_LIMIT', '요청이 너무 많습니다.')
    const pending = await prisma.pendingRegistration.findUnique({ where: { tokenHash: sha256(token) } })
    if (!pending || pending.expiresAt <= new Date()) throw new HttpError(410, 'EXPIRED', '가입 시간이 만료되었습니다. 처음부터 다시 진행하세요.')
    if (!pending.verifiedAt || !pending.discordUserId) {
      res.status(202).json({ pending: true })
      return
    }
    await prisma.pendingRegistration.delete({ where: { id: pending.id } })
    await assertAvailable(pending.email, pending.username)
    if (await prisma.user.findUnique({ where: { discordUserId: pending.discordUserId } })) {
      throw new HttpError(409, 'CONFLICT', '이 Discord 계정은 이미 다른 Livebrary 계정에 연결되어 있습니다.')
    }
    const user = await createUser({
      email: pending.email,
      username: pending.username,
      passwordHash: pending.passwordHash,
      discordUserId: pending.discordUserId,
      discordName: pending.discordName,
    })
    await issueSession(res, user.id, clientIp(req), userAgent(req))
    ensureCsrf(req, res)
    res.status(201).json({ user: publicUser(user) })
  }))

  router.post('/login', wrap(async (req, res) => {
    const email = String((req.body as { email?: string }).email ?? '').trim().toLowerCase()
    const password = String((req.body as { password?: string }).password ?? '')
    const allowed = await limiter.hit(`login:${clientIp(req)}:${email}`, 8, 15 * 60 * 1000)
    if (!allowed) {
      await recordAudit({ eventType: 'LOGIN_FAILED', result: 'DENIED', metadata: { email, ip: clientIp(req), reason: 'rate limit' } })
      throw new HttpError(429, 'RATE_LIMIT', '로그인 시도가 너무 많습니다.')
    }
    const user = await prisma.user.findUnique({ where: { email } })
    const valid = user ? await verifySecret(user.passwordHash, password) : await hashSecret(password).then(() => false)
    if (!user || !valid) {
      await recordAudit({
        eventType: 'LOGIN_FAILED',
        actorId: user?.id,
        result: 'FAILURE',
        resourceType: 'user',
        resourceId: user?.id ?? '',
        metadata: { email, ip: clientIp(req) },
      })
      throw new HttpError(401, 'UNAUTHORIZED', '이메일 또는 비밀번호가 올바르지 않습니다.')
    }
    if (user.status !== 'ACTIVE') {
      await recordAudit({ eventType: 'LOGIN_FAILED', actorId: user.id, result: 'DENIED', metadata: { username: user.username, reason: 'limited' } })
      throw new HttpError(403, 'FORBIDDEN', '제한된 계정입니다.')
    }
    await issueSession(res, user.id, clientIp(req), userAgent(req))
    ensureCsrf(req, res)
    await recordAudit({ eventType: 'LOGIN', actorId: user.id, result: 'SUCCESS', resourceType: 'user', resourceId: user.id, metadata: { username: user.username } })
    res.json({ user: publicUser(user) })
  }))

  router.post('/logout', wrap(async (req, res) => {
    const cookies = req.cookies as Record<string, string | undefined>
    await revokeSessionToken(cookies.lb_session)
    await revokeAdminToken(cookies.lb_admin)
    await revokeGateToken(cookies.lb_gate)
    if (req.user) {
      await recordAudit({ eventType: 'LOGOUT', actorId: req.user.id, result: 'SUCCESS', resourceType: 'user', resourceId: req.user.id, metadata: { username: req.user.username } })
    }
    clearAuthCookies(res)
    clearGateCookie(res)
    res.json({ ok: true })
  }))

  return router
}
