import { Server } from '@hocuspocus/server'
import { canWrite, parseDocumentName, type ProjectRoleName } from '@livebrary/shared'
import { YJS_TEXT_KEY, asYDoc } from '@livebrary/shared/yjs-text'
import * as Y from 'yjs'

export type CollabContext = {
  userId: string
  username: string
  role: ProjectRoleName
  projectId: string
  fileId: string
  projectName: string
  filePath: string
}

export type CollaborationDeps = {
  port: number
  originAllowed: (origin: string | null, host?: string | null) => boolean
  authenticate: (cookie: string | null) => Promise<{ id: string; username: string; status: string } | null>
  authorize: (
    userId: string,
    projectId: string,
    fileId: string,
  ) => Promise<Omit<CollabContext, 'userId' | 'username'> | null>
  load: (projectId: string, fileId: string) => Promise<Uint8Array | null>
  save: (projectId: string, fileId: string, state: Uint8Array, text: string, context: CollabContext | null) => Promise<void>
  onEdit: (context: CollabContext) => void
}

type Tracked = {
  userId: string
  projectId: string
  documentName: string
  close: () => void
}

function stateless(document: unknown, payload: string): void {
  const candidate = document as { broadcastStateless?: (value: string) => void }
  candidate.broadcastStateless?.(payload)
}

export function createCollaboration(deps: CollaborationDeps) {
  const tracked = new Map<string, Tracked>()
  const hocuspocus = new Server({
    port: deps.port,
    address: '127.0.0.1',
    name: 'livebrary',
    quiet: true,
    debounce: 2000,
    maxDebounce: 10_000,
    async onConnect(data) {
      const origin = data.requestHeaders.get('origin')
      if (!deps.originAllowed(origin, data.requestHeaders.get('host'))) throw new Error('origin rejected')
    },
    async onAuthenticate(data) {
      const parsed = parseDocumentName(data.documentName)
      if (!parsed) throw new Error('document rejected')
      const user = await deps.authenticate(data.requestHeaders.get('cookie'))
      if (!user || user.status !== 'ACTIVE') throw new Error('unauthorized')
      const access = await deps.authorize(user.id, parsed.projectId, parsed.fileId)
      if (!access) throw new Error('unauthorized')
      if (!canWrite(access.role)) data.connectionConfig.readOnly = true
      const context: CollabContext = { userId: user.id, username: user.username, ...access }
      return context
    },
    async connected(data) {
      const context = data.context as CollabContext
      const connection = data.connection as { close?: (code?: number, reason?: string) => void }
      tracked.set(data.socketId, {
        userId: context.userId,
        projectId: context.projectId,
        documentName: data.documentName,
        close: () => connection.close?.(4003, 'access changed'),
      })
    },
    async onDisconnect(data) {
      tracked.delete(data.socketId)
    },
    async onLoadDocument(data) {
      const parsed = parseDocumentName(data.documentName)
      if (!parsed) return
      const state = await deps.load(parsed.projectId, parsed.fileId)
      if (!state || state.byteLength === 0) return
      Y.applyUpdate(asYDoc(data.document), state)
    },
    async onChange(data) {
      const context = data.context as CollabContext | undefined
      if (!context || !canWrite(context.role)) return
      deps.onEdit(context)
    },
    async onStoreDocument(data) {
      const parsed = parseDocumentName(data.documentName)
      if (!parsed) return
      const doc = asYDoc(data.document)
      stateless(data.document, 'saving')
      await deps.save(
        parsed.projectId,
        parsed.fileId,
        Y.encodeStateAsUpdate(doc),
        doc.getText(YJS_TEXT_KEY).toString(),
        (data.lastContext as CollabContext | null) ?? null,
      )
      stateless(data.document, 'saved')
    },
  })

  function closeMatching(predicate: (entry: Tracked) => boolean): void {
    for (const [id, entry] of tracked) {
      if (!predicate(entry)) continue
      entry.close()
      tracked.delete(id)
    }
  }

  hocuspocus.listen()

  async function openDirect(documentName: string) {
    const host = hocuspocus as unknown as {
      openDirectConnection?: (name: string, context: object) => Promise<{
        transact: (transaction: (document: unknown) => void) => Promise<void>
        disconnect: () => Promise<void>
      }>
      hocuspocus?: {
        openDirectConnection?: (name: string, context: object) => Promise<{
          transact: (transaction: (document: unknown) => void) => Promise<void>
          disconnect: () => Promise<void>
        }>
      }
    }
    const opener = host.openDirectConnection ?? host.hocuspocus?.openDirectConnection
    if (!opener) throw new Error('Direct document connection is unavailable')
    const target = host.openDirectConnection ? host : host.hocuspocus
    return opener.call(target, documentName, {})
  }

  return {
    hocuspocus,
    disconnectUser(userId: string, projectId?: string) {
      closeMatching((entry) => entry.userId === userId && (!projectId || entry.projectId === projectId))
    },
    closeDocument(documentName: string) {
      closeMatching((entry) => entry.documentName === documentName)
    },
    closeProject(projectId: string) {
      closeMatching((entry) => entry.projectId === projectId)
    },
    async restoreText(documentName: string, text: string) {
      const direct = await openDirect(documentName)
      await direct.transact((document) => {
        const doc = asYDoc(document)
        const ytext = doc.getText(YJS_TEXT_KEY)
        ytext.delete(0, ytext.length)
        if (text) ytext.insert(0, text)
      })
      await direct.disconnect()
    },
    async destroy() {
      await hocuspocus.destroy()
    },
  }
}

export type CollaborationController = ReturnType<typeof createCollaboration>
