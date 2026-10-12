import { Router } from 'express'
import { prisma, type ChatMessageKind } from '@livebrary/database'
import { isUuid } from '@livebrary/shared'
import { requireAccess } from '../access.js'
import { broadcastProject, sendToUser } from '../hub.js'
import { HttpError, routeParam, wrap } from '../http.js'

function cleanContent(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(400, 'VALIDATION', '메시지 내용이 필요합니다.')
  const content = value.replace(/\u0000/g, '').trim()
  if (!content || content.length > 2000) throw new HttpError(400, 'VALIDATION', '메시지는 1~2000자여야 합니다.')
  return content
}

export function chatRouter(): Router {
  const router = Router()

  router.get('/projects/:id/channels', wrap(async (req, res) => {
    const access = await requireAccess(req.user!.id, routeParam(req.params.id), 'read')
    const channels = await prisma.chatChannel.findMany({
      where: { projectId: access.project.id },
      orderBy: { createdAt: 'asc' },
    })
    const reads = await prisma.channelRead.findMany({ where: { userId: req.user!.id, channelId: { in: channels.map((channel) => channel.id) } } })
    const readMap = new Map(reads.map((item) => [item.channelId, item.lastReadAt]))
    const withUnread = await Promise.all(channels.map(async (channel) => ({
      ...channel,
      unread: await prisma.chatMessage.count({
        where: { channelId: channel.id, createdAt: { gt: readMap.get(channel.id) ?? new Date(0) }, NOT: { userId: req.user!.id } },
      }),
    })))
    res.json({ channels: withUnread })
  }))

  router.get('/projects/:id/channels/:channelId/messages', wrap(async (req, res) => {
    const access = await requireAccess(req.user!.id, routeParam(req.params.id), 'read')
    const channel = await prisma.chatChannel.findFirst({
      where: { id: routeParam(req.params.channelId), projectId: access.project.id },
    })
    if (!channel) throw new HttpError(404, 'NOT_FOUND', '채널을 찾을 수 없습니다.')
    const before = typeof req.query.before === 'string' ? new Date(req.query.before) : null
    const messages = await prisma.chatMessage.findMany({
      where: {
        channelId: channel.id,
        ...(before && !Number.isNaN(before.getTime()) ? { createdAt: { lt: before } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 80,
      include: { user: { select: { username: true } } },
    })
    res.json({
      messages: messages.reverse().map((message) => ({
        id: message.id,
        channelId: message.channelId,
        username: message.user?.username ?? 'system',
        content: message.content,
        kind: message.kind,
        createdAt: message.createdAt,
      })),
    })
  }))

  router.post('/projects/:id/channels/:channelId/messages', wrap(async (req, res) => {
    const access = await requireAccess(req.user!.id, routeParam(req.params.id), 'read')
    const channel = await prisma.chatChannel.findFirst({
      where: { id: routeParam(req.params.channelId), projectId: access.project.id },
    })
    if (!channel) throw new HttpError(404, 'NOT_FOUND', '채널을 찾을 수 없습니다.')
    const kind: ChatMessageKind = (req.body as { kind?: string }).kind === 'ACTION' ? 'ACTION' : 'MESSAGE'
    const content = cleanContent((req.body as { content?: string }).content)
    const message = await prisma.chatMessage.create({
      data: { channelId: channel.id, userId: req.user!.id, content, kind },
    })
    await prisma.channelRead.upsert({
      where: { channelId_userId: { channelId: channel.id, userId: req.user!.id } },
      update: { lastReadAt: new Date() },
      create: { channelId: channel.id, userId: req.user!.id },
    })
    const payload = {
      type: 'chat',
      message: {
        id: message.id,
        channelId: channel.id,
        projectId: access.project.id,
        username: req.user!.username,
        content,
        kind,
        createdAt: message.createdAt,
      },
    }
    broadcastProject(access.project.id, payload)
    res.status(201).json(payload)
  }))

  router.post('/projects/:id/channels/:channelId/read', wrap(async (req, res) => {
    const access = await requireAccess(req.user!.id, routeParam(req.params.id), 'read')
    const channelId = routeParam(req.params.channelId)
    if (!isUuid(channelId)) throw new HttpError(404, 'NOT_FOUND', '채널을 찾을 수 없습니다.')
    const channel = await prisma.chatChannel.findFirst({ where: { id: channelId, projectId: access.project.id } })
    if (!channel) throw new HttpError(404, 'NOT_FOUND', '채널을 찾을 수 없습니다.')
    await prisma.channelRead.upsert({
      where: { channelId_userId: { channelId, userId: req.user!.id } },
      update: { lastReadAt: new Date() },
      create: { channelId, userId: req.user!.id },
    })
    res.json({ ok: true })
  }))

  router.get('/messages/direct', wrap(async (req, res) => {
    const messages = await prisma.directMessage.findMany({
      where: { OR: [{ senderId: req.user!.id }, { recipientId: req.user!.id }] },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        sender: { select: { username: true } },
        recipient: { select: { username: true } },
      },
    })
    res.json({
      messages: messages.reverse().map((message) => ({
        id: message.id,
        from: message.sender.username,
        to: message.recipient.username,
        content: message.content,
        createdAt: message.createdAt,
        mine: message.senderId === req.user!.id,
      })),
    })
  }))

  router.post('/messages/direct', wrap(async (req, res) => {
    const username = String((req.body as { username?: string }).username ?? '').trim().toLowerCase()
    const content = cleanContent((req.body as { content?: string }).content)
    const recipient = await prisma.user.findUnique({ where: { usernameNormalized: username } })
    if (!recipient || recipient.status !== 'ACTIVE') throw new HttpError(404, 'NOT_FOUND', '사용자를 찾을 수 없습니다.')
    if (recipient.id === req.user!.id) throw new HttpError(400, 'VALIDATION', '자기 자신에게는 보낼 수 없습니다.')
    const message = await prisma.directMessage.create({
      data: { senderId: req.user!.id, recipientId: recipient.id, content },
    })
    const payload = {
      type: 'dm',
      message: { id: message.id, from: req.user!.username, to: recipient.username, content, createdAt: message.createdAt },
    }
    sendToUser(recipient.id, payload)
    sendToUser(req.user!.id, payload)
    res.status(201).json(payload)
  }))

  return router
}
