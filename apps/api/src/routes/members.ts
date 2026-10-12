import { Router } from 'express'
import { prisma } from '@livebrary/database'
import { randomToken, sha256 } from '@livebrary/database/crypto'
import { recordAudit } from '@livebrary/discord-logger'
import { isUuid } from '@livebrary/shared'
import { requireAccess } from '../access.js'
import { config } from '../config.js'
import { collaboration } from '../collab-registry.js'
import { closeProjectUser } from '../hub.js'
import { HttpError, routeParam, wrap } from '../http.js'

const ROLES = new Set(['EDITOR', 'VIEWER'])

export function memberRouter(): Router {
  const router = Router()

  router.get('/projects/:id/members', wrap(async (req, res) => {
    const access = await requireAccess(req.user!.id, routeParam(req.params.id), 'read')
    const members = await prisma.projectMember.findMany({
      where: { projectId: access.project.id },
      include: { user: { select: { id: true, username: true, avatarUrl: true, primaryLanguage: true } } },
      orderBy: { joinedAt: 'asc' },
    })
    res.json({
      members: members.map((item) => ({
        userId: item.userId,
        username: item.user.username,
        avatarUrl: item.user.avatarUrl,
        primaryLanguage: item.user.primaryLanguage,
        role: item.role,
        joinedAt: item.joinedAt,
      })),
    })
  }))

  router.get('/projects/:id/invitations', wrap(async (req, res) => {
    const access = await requireAccess(req.user!.id, routeParam(req.params.id), 'manage')
    const invitations = await prisma.projectInvitation.findMany({
      where: { projectId: access.project.id },
      orderBy: { createdAt: 'desc' },
      include: { invitedUser: { select: { username: true } } },
    })
    res.json({
      invitations: invitations.map((item) => ({
        id: item.id,
        role: item.role,
        status: item.status,
        invitedEmail: item.invitedEmail,
        username: item.invitedUser?.username ?? null,
        expiresAt: item.expiresAt,
        createdAt: item.createdAt,
      })),
    })
  }))

  router.post('/projects/:id/invitations', wrap(async (req, res) => {
    const access = await requireAccess(req.user!.id, routeParam(req.params.id), 'manage')
    const body = req.body as { username?: string; email?: string; role?: string; expiresInHours?: number }
    const role = body.role ?? 'VIEWER'
    if (!ROLES.has(role)) throw new HttpError(400, 'VALIDATION', '권한은 EDITOR 또는 VIEWER만 초대할 수 있습니다.')
    const username = body.username?.trim()
    const email = body.email?.trim().toLowerCase()
    if (!username && !email) throw new HttpError(400, 'VALIDATION', '사용자 이름 또는 이메일이 필요합니다.')
    const invited = username
      ? await prisma.user.findUnique({ where: { usernameNormalized: username.toLowerCase() } })
      : email
        ? await prisma.user.findUnique({ where: { email } })
        : null
    if (username && !invited) throw new HttpError(404, 'NOT_FOUND', '사용자를 찾을 수 없습니다.')
    if (invited?.id === req.user!.id) throw new HttpError(400, 'VALIDATION', '자기 자신은 초대할 수 없습니다.')
    if (invited) {
      const existing = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: access.project.id, userId: invited.id } },
      })
      if (existing) throw new HttpError(409, 'CONFLICT', '이미 프로젝트 멤버입니다.')
    }
    const hours = body.expiresInHours == null ? 168 : Number(body.expiresInHours)
    if (!Number.isFinite(hours) || hours < 1 || hours > 720) throw new HttpError(400, 'VALIDATION', '만료 시간은 1시간에서 720시간 사이여야 합니다.')
    const token = randomToken()
    const invitation = await prisma.projectInvitation.create({
      data: {
        projectId: access.project.id,
        invitedUserId: invited?.id,
        invitedEmail: email ?? invited?.email ?? null,
        tokenHash: sha256(token),
        role: role as 'EDITOR' | 'VIEWER',
        expiresAt: new Date(Date.now() + hours * 60 * 60 * 1000),
        createdById: req.user!.id,
      },
    })
    await recordAudit({
      eventType: 'MEMBER_INVITED',
      actorId: req.user!.id,
      projectId: access.project.id,
      resourceType: 'invitation',
      resourceId: invitation.id,
      result: 'SUCCESS',
      metadata: { role, username: invited?.username, projectName: access.project.name },
    })
    res.status(201).json({
      invitation: { id: invitation.id, expiresAt: invitation.expiresAt, role },
      link: `${config.appOrigin}/invite/${token}`,
    })
  }))

  router.delete('/projects/:id/invitations/:invitationId', wrap(async (req, res) => {
    const access = await requireAccess(req.user!.id, routeParam(req.params.id), 'manage')
    const invitation = await prisma.projectInvitation.findFirst({
      where: { id: routeParam(req.params.invitationId), projectId: access.project.id, status: 'PENDING' },
    })
    if (!invitation) throw new HttpError(404, 'NOT_FOUND', '초대를 찾을 수 없습니다.')
    await prisma.projectInvitation.update({ where: { id: invitation.id }, data: { status: 'REVOKED' } })
    res.json({ ok: true })
  }))

  router.get('/invitations', wrap(async (req, res) => {
    const invitations = await prisma.projectInvitation.findMany({
      where: {
        status: 'PENDING',
        OR: [{ invitedUserId: req.user!.id }, { invitedEmail: req.user!.email }],
      },
      include: { project: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    })
    res.json({
      invitations: invitations.map((item) => ({
        id: item.id,
        projectId: item.project.id,
        projectName: item.project.name,
        role: item.role,
        expiresAt: item.expiresAt,
      })),
    })
  }))

  router.post('/invitations/:token/accept', wrap(async (req, res) => {
    const invitation = await findToken(routeParam(req.params.token))
    assertInvitee(invitation, req.user!.id, req.user!.email)
    await completeAccept(invitation, req.user!)
    res.json({ projectId: invitation.projectId })
  }))

  router.post('/invitations/:token/decline', wrap(async (req, res) => {
    const invitation = await findToken(routeParam(req.params.token))
    assertInvitee(invitation, req.user!.id, req.user!.email)
    await completeDecline(invitation, req.user!)
    res.json({ ok: true })
  }))

  router.post('/invitations/by-id/:id/accept', wrap(async (req, res) => {
    const invitation = await findOwnedPending(routeParam(req.params.id), req.user!.id, req.user!.email)
    await completeAccept(invitation, req.user!)
    res.json({ projectId: invitation.projectId })
  }))

  router.post('/invitations/by-id/:id/decline', wrap(async (req, res) => {
    const invitation = await findOwnedPending(routeParam(req.params.id), req.user!.id, req.user!.email)
    await completeDecline(invitation, req.user!)
    res.json({ ok: true })
  }))

  router.patch('/projects/:id/members/:userId', wrap(async (req, res) => {
    const access = await requireAccess(req.user!.id, routeParam(req.params.id), 'manage')
    const userId = routeParam(req.params.userId)
    if (!isUuid(userId)) throw new HttpError(404, 'NOT_FOUND', '멤버를 찾을 수 없습니다.')
    const role = (req.body as { role?: string }).role
    if (role !== 'EDITOR' && role !== 'VIEWER') throw new HttpError(400, 'VALIDATION', '변경할 수 있는 권한은 EDITOR 또는 VIEWER입니다.')
    const member = await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: access.project.id, userId } } })
    if (!member) throw new HttpError(404, 'NOT_FOUND', '멤버를 찾을 수 없습니다.')
    if (member.role === 'OWNER') throw new HttpError(400, 'VALIDATION', '소유자 권한은 변경할 수 없습니다.')
    await prisma.projectMember.update({ where: { id: member.id }, data: { role } })
    collaboration()?.disconnectUser(userId, access.project.id)
    closeProjectUser(userId, access.project.id)
    await recordAudit({
      eventType: 'PERMISSION_CHANGED',
      actorId: req.user!.id,
      projectId: access.project.id,
      resourceType: 'member',
      resourceId: userId,
      result: 'SUCCESS',
      metadata: { role, projectName: access.project.name },
    })
    res.json({ ok: true })
  }))

  router.delete('/projects/:id/members/:userId', wrap(async (req, res) => {
    const access = await requireAccess(req.user!.id, routeParam(req.params.id), 'manage')
    const userId = routeParam(req.params.userId)
    const member = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: access.project.id, userId } },
      include: { user: { select: { username: true } } },
    })
    if (!member) throw new HttpError(404, 'NOT_FOUND', '멤버를 찾을 수 없습니다.')
    if (member.role === 'OWNER') throw new HttpError(400, 'VALIDATION', '소유자는 내보낼 수 없습니다.')
    await prisma.projectMember.delete({ where: { id: member.id } })
    collaboration()?.disconnectUser(userId, access.project.id)
    closeProjectUser(userId, access.project.id)
    await recordAudit({
      eventType: 'MEMBER_REMOVED',
      actorId: req.user!.id,
      projectId: access.project.id,
      resourceType: 'member',
      resourceId: userId,
      result: 'SUCCESS',
      metadata: { username: member.user.username, projectName: access.project.name },
    })
    res.json({ ok: true })
  }))

  return router
}

async function findToken(token: string) {
  const invitation = await prisma.projectInvitation.findUnique({ where: { tokenHash: sha256(token) } })
  if (!invitation || invitation.status !== 'PENDING') throw new HttpError(404, 'NOT_FOUND', '초대를 찾을 수 없습니다.')
  if (invitation.expiresAt && invitation.expiresAt <= new Date()) {
    await prisma.projectInvitation.update({ where: { id: invitation.id }, data: { status: 'EXPIRED' } })
    throw new HttpError(410, 'EXPIRED', '만료된 초대입니다.')
  }
  return invitation
}

function assertInvitee(invitation: { invitedUserId: string | null; invitedEmail: string | null }, userId: string, email: string) {
  if (invitation.invitedUserId && invitation.invitedUserId !== userId) {
    throw new HttpError(403, 'FORBIDDEN', '이 초대는 다른 계정으로 발송되었습니다.')
  }
  if (!invitation.invitedUserId && invitation.invitedEmail && invitation.invitedEmail !== email) {
    throw new HttpError(403, 'FORBIDDEN', '이 초대는 다른 이메일로 발송되었습니다.')
  }
}

async function findOwnedPending(id: string, userId: string, email: string) {
  if (!isUuid(id)) throw new HttpError(404, 'NOT_FOUND', '초대를 찾을 수 없습니다.')
  const invitation = await prisma.projectInvitation.findUnique({ where: { id } })
  if (!invitation || invitation.status !== 'PENDING') throw new HttpError(404, 'NOT_FOUND', '초대를 찾을 수 없습니다.')
  if (invitation.expiresAt && invitation.expiresAt <= new Date()) {
    await prisma.projectInvitation.update({ where: { id: invitation.id }, data: { status: 'EXPIRED' } })
    throw new HttpError(410, 'EXPIRED', '만료된 초대입니다.')
  }
  assertInvitee(invitation, userId, email)
  return invitation
}

async function completeAccept(
  invitation: { id: string; projectId: string; role: 'OWNER' | 'EDITOR' | 'VIEWER' },
  user: { id: string; username: string },
) {
  const existing = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: invitation.projectId, userId: user.id } },
  })
  await prisma.$transaction(async (tx) => {
    if (!existing) {
      await tx.projectMember.create({
        data: { projectId: invitation.projectId, userId: user.id, role: invitation.role },
      })
    }
    await tx.projectInvitation.update({ where: { id: invitation.id }, data: { status: 'ACCEPTED', invitedUserId: user.id } })
    await recordAudit({
      eventType: 'INVITE_ACCEPTED',
      actorId: user.id,
      projectId: invitation.projectId,
      resourceType: 'invitation',
      resourceId: invitation.id,
      result: 'SUCCESS',
      metadata: { role: invitation.role, username: user.username },
    }, tx)
  })
}

async function completeDecline(invitation: { id: string; projectId: string }, user: { id: string; username: string }) {
  await prisma.projectInvitation.update({ where: { id: invitation.id }, data: { status: 'DECLINED' } })
  await recordAudit({
    eventType: 'INVITE_DECLINED',
    actorId: user.id,
    projectId: invitation.projectId,
    resourceType: 'invitation',
    resourceId: invitation.id,
    result: 'SUCCESS',
    metadata: { username: user.username },
  })
}
