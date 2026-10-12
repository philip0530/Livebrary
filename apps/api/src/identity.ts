import type { CookieOptions, Request, Response } from 'express'
import { prisma, type User } from '@livebrary/database'
import { randomToken, sha256 } from '@livebrary/database/crypto'
import { ADMIN_MS, GATE_MS, SESSION_MS, config } from './config.js'
import { readCookieHeader } from './http.js'

export type SessionUser = {
  id: string
  email: string
  username: string
  systemRole: User['systemRole']
  status: User['status']
  avatarUrl: string | null
  bio: string
  primaryLanguage: string
  discordUserId: string | null
  createdAt: Date
}

const userSelect = {
  id: true,
  email: true,
  username: true,
  systemRole: true,
  status: true,
  avatarUrl: true,
  bio: true,
  primaryLanguage: true,
  discordUserId: true,
  createdAt: true,
} as const

function cookieOptions(maxAge: number, httpOnly = true): CookieOptions {
  return {
    httpOnly,
    secure: config.secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge,
  }
}

export function ensureCsrf(req: Request, res: Response): void {
  const cookies = req.cookies as Record<string, string | undefined>
  if (cookies.lb_csrf) return
  res.cookie('lb_csrf', randomToken(24), cookieOptions(SESSION_MS, false))
}

export async function issueGate(req: Request, res: Response, ip: string, userAgent: string): Promise<void> {
  const token = randomToken()
  await prisma.gateSession.create({
    data: { sessionHash: sha256(token), expiresAt: new Date(Date.now() + GATE_MS), ip, userAgent },
  })
  res.cookie('lb_gate', token, cookieOptions(GATE_MS))
  ensureCsrf(req, res)
}

export async function gateFromRequest(req: Request) {
  const token = (req.cookies as Record<string, string | undefined>).lb_gate
  if (!token) return null
  const gate = await prisma.gateSession.findUnique({ where: { sessionHash: sha256(token) } })
  if (!gate || gate.expiresAt <= new Date()) return null
  return gate
}

export async function issueSession(res: Response, userId: string, ip: string, userAgent: string): Promise<void> {
  const token = randomToken()
  await prisma.userSession.create({
    data: {
      userId,
      sessionHash: sha256(token),
      expiresAt: new Date(Date.now() + SESSION_MS),
      ip,
      userAgent,
    },
  })
  res.cookie('lb_session', token, cookieOptions(SESSION_MS))
}

export async function userFromToken(token: string | null | undefined): Promise<SessionUser | null> {
  if (!token) return null
  const session = await prisma.userSession.findUnique({
    where: { sessionHash: sha256(token) },
    include: { user: { select: userSelect } },
  })
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null
  return session.user
}

export async function userFromRequest(req: Request): Promise<SessionUser | null> {
  return userFromToken((req.cookies as Record<string, string | undefined>).lb_session)
}

export async function userFromCookieHeader(header: string | undefined): Promise<SessionUser | null> {
  return userFromToken(readCookieHeader(header, 'lb_session'))
}

export async function revokeSessionToken(token: string | null | undefined): Promise<void> {
  if (!token) return
  await prisma.userSession.updateMany({
    where: { sessionHash: sha256(token), revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export async function issueAdminSession(res: Response, userId: string): Promise<Date> {
  const token = randomToken()
  const expiresAt = new Date(Date.now() + ADMIN_MS)
  await prisma.adminSession.create({
    data: { userId, sessionHash: sha256(token), mfaVerifiedAt: new Date(), expiresAt },
  })
  res.cookie('lb_admin', token, cookieOptions(ADMIN_MS))
  return expiresAt
}

export async function adminFromRequest(req: Request): Promise<SessionUser | null> {
  const token = (req.cookies as Record<string, string | undefined>).lb_admin
  if (!token) return null
  const session = await prisma.adminSession.findUnique({
    where: { sessionHash: sha256(token) },
    include: { user: { select: userSelect } },
  })
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null
  if (session.user.systemRole !== 'SYSTEM_ADMIN' || session.user.status !== 'ACTIVE') return null
  return session.user
}

export async function revokeAdminToken(token: string | null | undefined): Promise<void> {
  if (!token) return
  await prisma.adminSession.updateMany({
    where: { sessionHash: sha256(token), revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export function clearAuthCookies(res: Response): void {
  const expired = { ...cookieOptions(0), maxAge: 0 }
  res.clearCookie('lb_session', expired)
  res.clearCookie('lb_admin', expired)
}

export async function revokeGateToken(token: string | null | undefined): Promise<void> {
  if (!token) return
  await prisma.gateSession.deleteMany({ where: { sessionHash: sha256(token) } })
}

export function clearGateCookie(res: Response): void {
  res.clearCookie('lb_gate', { ...cookieOptions(0), maxAge: 0 })
}

export function publicUser(user: SessionUser) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    systemRole: user.systemRole,
    status: user.status,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    primaryLanguage: user.primaryLanguage,
    createdAt: user.createdAt,
  }
}
