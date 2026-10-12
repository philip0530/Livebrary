import type { IncomingMessage } from 'node:http'
import type { WebSocket } from 'ws'
import { prisma } from '@livebrary/database'
import { runtime } from '@livebrary/discord-logger'
import { isUuid } from '@livebrary/shared'
import { projectAccess } from './access.js'
import { userFromCookieHeader } from './identity.js'

type Client = {
  socket: WebSocket
  userId: string
  username: string
  projectId: string | null
  role: string | null
  fileId: string | null
  fileName: string | null
}

const clients = new Set<Client>()

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload))
}

export function broadcastProject(projectId: string, payload: unknown, except?: WebSocket): void {
  for (const client of clients) {
    if (client.projectId === projectId && client.socket !== except) send(client.socket, payload)
  }
}

export function sendToUser(userId: string, payload: unknown): void {
  for (const client of clients) {
    if (client.userId === userId) send(client.socket, payload)
  }
}

export function closeProjectUser(userId: string, projectId: string): void {
  for (const client of clients) {
    if (client.userId === userId && client.projectId === projectId) client.socket.close(4003, 'access changed')
  }
}

export function closeProject(projectId: string): void {
  for (const client of clients) {
    if (client.projectId === projectId) client.socket.close(4003, 'project closed')
  }
}

function broadcastPresence(projectId: string): void {
  const byUser = new Map<string, { userId: string; username: string; role: string | null; fileId: string | null; fileName: string | null }>()
  for (const client of clients) {
    if (client.projectId !== projectId) continue
    byUser.set(client.userId, {
      userId: client.userId,
      username: client.username,
      role: client.role,
      fileId: client.fileId,
      fileName: client.fileName,
    })
  }
  broadcastProject(projectId, { type: 'presence', users: [...byUser.values()] })
}

export async function connectSocket(socket: WebSocket, request: IncomingMessage): Promise<void> {
  const user = await userFromCookieHeader(request.headers.cookie)
  if (!user || user.status !== 'ACTIVE') {
    socket.close(4001, 'unauthorized')
    return
  }
  const client: Client = {
    socket,
    userId: user.id,
    username: user.username,
    projectId: null,
    role: null,
    fileId: null,
    fileName: null,
  }
  clients.add(client)
  runtime.websocketConnections = clients.size
  send(socket, { type: 'ready' })
  socket.on('message', (raw) => {
    void onMessage(client, raw).catch(() => {
      send(socket, { type: 'error', message: '요청을 처리하지 못했습니다.' })
    })
  })
  socket.on('close', () => {
    const projectId = client.projectId
    clients.delete(client)
    runtime.websocketConnections = clients.size
    if (!projectId) return
    const stillThere = [...clients].some((item) => item.userId === client.userId && item.projectId === projectId)
    if (!stillThere) {
      broadcastProject(projectId, { type: 'system', text: `*** ${client.username} left` })
      broadcastPresence(projectId)
    }
  })
}

async function onMessage(client: Client, raw: unknown): Promise<void> {
  const message = JSON.parse(String(raw)) as { type?: string; projectId?: string; fileId?: string | null }
  if (message.type === 'ping') {
    send(client.socket, { type: 'pong' })
    return
  }
  if (message.type === 'subscribe' && message.projectId && isUuid(message.projectId)) {
    const access = await projectAccess(client.userId, message.projectId)
    const already = [...clients].some(
      (item) => item !== client && item.userId === client.userId && item.projectId === access.project.id,
    )
    const previous = client.projectId
    client.projectId = access.project.id
    client.role = access.role
    if (!already) broadcastProject(access.project.id, { type: 'system', text: `*** ${client.username} joined` }, client.socket)
    broadcastPresence(access.project.id)
    if (previous && previous !== access.project.id) broadcastPresence(previous)
    return
  }
  if (message.type === 'focus' && client.projectId) {
    const fileId = message.fileId ?? null
    if (fileId && !isUuid(fileId)) return
    if (!fileId) {
      client.fileId = null
      client.fileName = null
    } else {
      const file = await prisma.projectFile.findFirst({ where: { id: fileId, projectId: client.projectId } })
      client.fileId = file?.id ?? null
      client.fileName = file?.name ?? null
    }
    broadcastPresence(client.projectId)
  }
}
