import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import { WebSocketServer } from 'ws'
import { prisma } from '@livebrary/database'
import { hashSecret } from '@livebrary/database/password'
import { createCollaboration } from '@livebrary/collaboration'
import { noteEdit, flushEdits, startDiscord, startDiscordQueue, startEditFlusher, startRotation, stopDiscord } from '@livebrary/discord-logger'
import { userFromCookieHeader } from './identity.js'
import { requireAccess } from './access.js'
import { filePath } from './tree.js'
import { createApp } from './app.js'
import { setCollaboration } from './collab-registry.js'
import { config, originAllowed } from './config.js'
import { connectSocket } from './hub.js'
import { saveDocument } from './persist.js'
import { createLimiter } from './rate-limit.js'
import { proxyUpgrade } from './ws-proxy.js'

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function siteUrls(scheme: string): string[] {
  const host = config.listenHost
  if (host !== '0.0.0.0' && host !== '::') return [`${scheme}://${host}:${config.apiPort}`]
  const urls = [`${scheme}://127.0.0.1:${config.apiPort}`]
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      const family = entry.family as string | number
      if (entry.internal || (family !== 'IPv4' && family !== 4)) continue
      urls.push(`${scheme}://${entry.address}:${config.apiPort}`)
    }
  }
  return urls
}

async function ensureFallback(): Promise<void> {
  const active = await prisma.adminFallbackCredential.findFirst({ where: { isActive: true } })
  if (active) return
  await prisma.adminFallbackCredential.create({
    data: { codeHash: await hashSecret(config.fallbackCode.toLowerCase()), isActive: true },
  })
  console.log('Initial fallback credential hash stored.')
}

const limiter = await createLimiter(config.redisUrl)
const app = createApp(limiter)
const server = config.tlsCertPath && config.tlsKeyPath
  ? createHttpsServer({ cert: readFileSync(config.tlsCertPath), key: readFileSync(config.tlsKeyPath) }, app)
  : createHttpServer(app)

const sockets = new WebSocketServer({ noServer: true, maxPayload: 65_536 })
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  const host = headerValue(request.headers.host)
  if (!originAllowed(headerValue(request.headers.origin), host)) {
    socket.destroy()
    return
  }
  if (url.pathname === '/ws') {
    sockets.handleUpgrade(request, socket, head, (ws) => {
      void connectSocket(ws, request)
    })
    return
  }
  if (url.pathname === '/collaboration' || url.pathname.startsWith('/collaboration/')) {
    proxyUpgrade(request, socket, head, config.collabPort)
    return
  }
  socket.destroy()
})

const collaboration = createCollaboration({
  port: config.collabPort,
  originAllowed,
  authenticate: (cookie) => userFromCookieHeader(cookie ?? undefined),
  async authorize(userId, projectId, fileId) {
    try {
      const access = await requireAccess(userId, projectId, 'read')
      const file = await prisma.projectFile.findFirst({ where: { id: fileId, projectId, type: 'FILE' } })
      if (!file) return null
      return {
        role: access.role,
        projectId,
        fileId,
        projectName: access.project.name,
        filePath: await filePath(fileId),
      }
    } catch {
      return null
    }
  },
  async load(_projectId, fileId) {
    const document = await prisma.collaborativeDocument.findUnique({ where: { fileId } })
    return document?.yjsState ?? null
  },
  save: saveDocument,
  onEdit(context) {
    noteEdit(context)
  },
})
setCollaboration(collaboration)

await ensureFallback()
await startDiscord().catch((error: unknown) => {
  console.warn(error instanceof Error ? `Discord bot not connected: ${error.message}` : 'Discord bot not connected')
})
const stopQueue = startDiscordQueue()
const stopEdits = startEditFlusher()
const stopRotation = startRotation()

server.listen(config.apiPort, config.listenHost, () => {
  const scheme = config.tlsCertPath ? 'https' : 'http'
  for (const url of siteUrls(scheme)) console.log(`Livebrary ${url}`)
  if (config.serveWeb) console.log('Web app, API, and collaboration are on this server.')
  else console.log(`Livebrary collaboration ws://127.0.0.1:${config.collabPort}`)
})

async function shutdown(): Promise<void> {
  stopQueue()
  stopEdits()
  stopRotation()
  await flushEdits(true).catch(() => undefined)
  await collaboration.destroy().catch(() => undefined)
  await stopDiscord().catch(() => undefined)
  await prisma.$disconnect()
  server.close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
