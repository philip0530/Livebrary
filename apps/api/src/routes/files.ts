import { Router } from 'express'
import { prisma } from '@livebrary/database'
import { sha256 } from '@livebrary/database/crypto'
import { recordAudit } from '@livebrary/discord-logger'
import { decodeTextState, encodeTextState } from '@livebrary/shared/yjs-text'
import { diffLines, documentName, isUuid, languageFromName } from '@livebrary/shared'
import { requireAccess } from '../access.js'
import { collaboration } from '../collab-registry.js'
import { broadcastProject } from '../hub.js'
import { HttpError, contentDisposition, routeParam, wrap } from '../http.js'
import { assertFolderParent, assertNoCycle, assertUniqueName, deleteTree, filePath } from '../tree.js'

function broadcastFiles(projectId: string): void {
  broadcastProject(projectId, { type: 'files', projectId })
}

export function fileRouter(): Router {
  const router = Router({ mergeParams: true })

  router.get('/', wrap(async (req, res) => {
    const access = await requireAccess(req.user!.id, routeParam(req.params.id), 'read')
    const files = await prisma.projectFile.findMany({
      where: { projectId: access.project.id },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      select: { id: true, parentId: true, name: true, type: true, language: true, updatedAt: true },
    })
    res.json({ files })
  }))

  router.get('/search', wrap(async (req, res) => {
    const access = await requireAccess(req.user!.id, routeParam(req.params.id), 'read')
    const q = String(req.query.q ?? '').trim()
    if (!q) {
      res.json({ files: [] })
      return
    }
    const found = await prisma.projectFile.findMany({
      where: { projectId: access.project.id, type: 'FILE', name: { contains: q, mode: 'insensitive' } },
      take: 50,
      select: { id: true, parentId: true, name: true, language: true },
    })
    const files = await Promise.all(found.map(async (file) => ({ ...file, path: await filePath(file.id) })))
    res.json({ files })
  }))

  router.post('/', wrap(async (req, res) => {
    const access = await requireAccess(req.user!.id, routeParam(req.params.id), 'write')
    const body = req.body as { parentId?: string | null; name?: string; type?: string; content?: string }
    const name = body.name?.trim() ?? ''
    const type = body.type === 'FOLDER' ? 'FOLDER' : 'FILE'
    const parentId = body.parentId ?? null
    if (parentId && !isUuid(parentId)) throw new HttpError(400, 'VALIDATION', '상위 폴더가 올바르지 않습니다.')
    await assertFolderParent(access.project.id, parentId)
    await assertUniqueName(access.project.id, parentId, name)
    const content = type === 'FILE' ? body.content ?? '' : ''
    if (content.length > 200_000) throw new HttpError(400, 'VALIDATION', '파일 내용이 너무 깁니다.')
    const file = await prisma.$transaction(async (tx) => {
      const created = await tx.projectFile.create({
        data: {
          projectId: access.project.id,
          parentId,
          name,
          type,
          language: type === 'FILE' ? languageFromName(name) : null,
        },
      })
      if (type === 'FILE') {
        await tx.collaborativeDocument.create({
          data: { projectId: access.project.id, fileId: created.id, yjsState: encodeTextState(content) },
        })
      }
      await tx.project.update({ where: { id: access.project.id }, data: { updatedAt: new Date() } })
      return created
    })
    const path = await filePath(file.id)
    await recordAudit({
      eventType: type === 'FOLDER' ? 'FOLDER_CREATED' : 'FILE_CREATED',
      actorId: req.user!.id,
      projectId: access.project.id,
      resourceType: type === 'FOLDER' ? 'folder' : 'file',
      resourceId: file.id,
      result: 'SUCCESS',
      metadata: { filePath: path, name: access.project.name },
    })
    broadcastFiles(access.project.id)
    res.status(201).json({ file })
  }))

  router.patch('/:fileId', wrap(async (req, res) => {
    const access = await requireAccess(req.user!.id, routeParam(req.params.id), 'write')
    const fileId = routeParam(req.params.fileId)
    const file = await prisma.projectFile.findFirst({ where: { id: fileId, projectId: access.project.id } })
    if (!file) throw new HttpError(404, 'NOT_FOUND', '파일을 찾을 수 없습니다.')
    const body = req.body as { name?: string; parentId?: string | null }
    const data: { name?: string; parentId?: string | null; language?: string | null } = {}
    let eventType: 'FILE_RENAMED' | 'FILE_MOVED' = 'FILE_RENAMED'
    if (body.name !== undefined) {
      await assertUniqueName(access.project.id, body.parentId === undefined ? file.parentId : body.parentId, body.name.trim(), file.id)
      data.name = body.name.trim()
      if (file.type === 'FILE') data.language = languageFromName(data.name)
    }
    if (body.parentId !== undefined) {
      const parentId = body.parentId
      if (parentId && !isUuid(parentId)) throw new HttpError(400, 'VALIDATION', '상위 폴더가 올바르지 않습니다.')
      await assertFolderParent(access.project.id, parentId)
      await assertNoCycle(file.id, parentId)
      if (body.name === undefined) await assertUniqueName(access.project.id, parentId, file.name, file.id)
      data.parentId = parentId
      eventType = 'FILE_MOVED'
    }
    const updated = await prisma.projectFile.update({ where: { id: file.id }, data })
    await recordAudit({
      eventType: file.type === 'FOLDER' && eventType === 'FILE_RENAMED' ? 'FILE_RENAMED' : eventType,
      actorId: req.user!.id,
      projectId: access.project.id,
      resourceType: file.type === 'FOLDER' ? 'folder' : 'file',
      resourceId: file.id,
      result: 'SUCCESS',
      metadata: { filePath: await filePath(file.id), projectName: access.project.name },
    })
    broadcastFiles(access.project.id)
    res.json({ file: updated })
  }))

  router.delete('/:fileId', wrap(async (req, res) => {
    const access = await requireAccess(req.user!.id, routeParam(req.params.id), 'write')
    const fileId = routeParam(req.params.fileId)
    const file = await prisma.projectFile.findFirst({ where: { id: fileId, projectId: access.project.id } })
    if (!file) throw new HttpError(404, 'NOT_FOUND', '파일을 찾을 수 없습니다.')
    const path = await filePath(file.id)
    const removed = await deleteTree(file.id)
    for (const id of removed) collaboration()?.closeDocument(documentName(access.project.id, id))
    if (file.type === 'FILE') collaboration()?.closeDocument(documentName(access.project.id, file.id))
    await recordAudit({
      eventType: file.type === 'FOLDER' ? 'FOLDER_DELETED' : 'FILE_DELETED',
      actorId: req.user!.id,
      projectId: access.project.id,
      resourceType: file.type === 'FOLDER' ? 'folder' : 'file',
      resourceId: file.id,
      result: 'SUCCESS',
      metadata: { filePath: path, projectName: access.project.name, removed: removed.length },
    })
    broadcastFiles(access.project.id)
    res.json({ ok: true })
  }))

  router.get('/:fileId/download', wrap(async (req, res) => {
    const access = await requireAccess(req.user!.id, routeParam(req.params.id), 'read')
    const file = await prisma.projectFile.findFirst({
      where: { id: routeParam(req.params.fileId), projectId: access.project.id, type: 'FILE' },
      include: { document: true },
    })
    if (!file) throw new HttpError(404, 'NOT_FOUND', '파일을 찾을 수 없습니다.')
    const text = file.document ? decodeTextState(file.document.yjsState) : ''
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Content-Disposition', contentDisposition(file.name))
    // 윈도우 메모장 등이 BOM 없는 UTF-8을 ANSI로 잘못 읽어 한글이 깨지므로 텍스트 파일에는 BOM을 붙입니다.
    res.send(/\.(md|markdown|txt)$/i.test(file.name) ? String.fromCharCode(0xfeff) + text : text)
  }))

  router.get('/:fileId/snapshots', wrap(async (req, res) => {
    const access = await requireAccess(req.user!.id, routeParam(req.params.id), 'read')
    const file = await prisma.projectFile.findFirst({ where: { id: routeParam(req.params.fileId), projectId: access.project.id, type: 'FILE' } })
    if (!file) throw new HttpError(404, 'NOT_FOUND', '파일을 찾을 수 없습니다.')
    const snapshots = await prisma.fileSnapshot.findMany({
      where: { fileId: file.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { createdBy: { select: { username: true } } },
    })
    res.json({
      snapshots: snapshots.map((item) => ({
        id: item.id,
        kind: item.kind,
        createdAt: item.createdAt,
        author: item.createdBy?.username ?? 'system',
        contentHash: item.contentHash,
      })),
    })
  }))

  router.post('/:fileId/snapshots', wrap(async (req, res) => {
    const access = await requireAccess(req.user!.id, routeParam(req.params.id), 'write')
    const file = await prisma.projectFile.findFirst({
      where: { id: routeParam(req.params.fileId), projectId: access.project.id, type: 'FILE' },
      include: { document: true },
    })
    if (!file?.document) throw new HttpError(404, 'NOT_FOUND', '파일을 찾을 수 없습니다.')
    const text = decodeTextState(file.document.yjsState)
    const snapshot = await prisma.fileSnapshot.create({
      data: {
        fileId: file.id,
        documentState: file.document.yjsState,
        textSnapshot: text,
        contentHash: sha256(text),
        kind: 'MANUAL',
        createdById: req.user!.id,
      },
    })
    await recordAudit({
      eventType: 'SNAPSHOT_CREATED',
      actorId: req.user!.id,
      projectId: access.project.id,
      resourceType: 'file',
      resourceId: file.id,
      result: 'SUCCESS',
      metadata: { filePath: await filePath(file.id), projectName: access.project.name },
    })
    res.status(201).json({ snapshot: { id: snapshot.id, createdAt: snapshot.createdAt, kind: snapshot.kind } })
  }))

  router.get('/:fileId/snapshots/:snapshotId', wrap(async (req, res) => {
    const access = await requireAccess(req.user!.id, routeParam(req.params.id), 'read')
    const snapshot = await loadSnapshot(access.project.id, routeParam(req.params.fileId), routeParam(req.params.snapshotId))
    res.json({
      snapshot: {
        id: snapshot.id,
        kind: snapshot.kind,
        createdAt: snapshot.createdAt,
        text: snapshot.textSnapshot,
        author: snapshot.createdBy?.username ?? 'system',
      },
    })
  }))

  router.get('/:fileId/snapshots/:snapshotId/diff', wrap(async (req, res) => {
    const access = await requireAccess(req.user!.id, routeParam(req.params.id), 'read')
    const snapshot = await loadSnapshot(access.project.id, routeParam(req.params.fileId), routeParam(req.params.snapshotId))
    const current = snapshot.file.document ? decodeTextState(snapshot.file.document.yjsState) : ''
    res.json({ lines: diffLines(snapshot.textSnapshot, current) })
  }))

  router.post('/:fileId/snapshots/:snapshotId/restore', wrap(async (req, res) => {
    const access = await requireAccess(req.user!.id, routeParam(req.params.id), 'restore')
    const snapshot = await loadSnapshot(access.project.id, routeParam(req.params.fileId), routeParam(req.params.snapshotId))
    if (!snapshot.file.document) throw new HttpError(404, 'NOT_FOUND', '협업 문서를 찾을 수 없습니다.')
    const currentText = decodeTextState(snapshot.file.document.yjsState)
    await prisma.fileSnapshot.create({
      data: {
        fileId: snapshot.fileId,
        documentState: snapshot.file.document.yjsState,
        textSnapshot: currentText,
        contentHash: sha256(currentText),
        kind: 'PRE_RESTORE',
        createdById: req.user!.id,
      },
    })
    const name = documentName(access.project.id, snapshot.fileId)
    try {
      const live = collaboration()
      if (!live) throw new Error('collaboration offline')
      await live.restoreText(name, snapshot.textSnapshot)
    } catch {
      await prisma.collaborativeDocument.update({
        where: { fileId: snapshot.fileId },
        data: { yjsState: snapshot.documentState },
      })
    }
    await recordAudit({
      eventType: 'FILE_RESTORED',
      actorId: req.user!.id,
      projectId: access.project.id,
      resourceType: 'file',
      resourceId: snapshot.fileId,
      result: 'SUCCESS',
      metadata: { filePath: await filePath(snapshot.fileId), projectName: access.project.name },
    })
    broadcastFiles(access.project.id)
    res.json({ ok: true })
  }))

  return router
}

async function loadSnapshot(projectId: string, fileId: string, snapshotId: string) {
  if (!isUuid(fileId) || !isUuid(snapshotId)) throw new HttpError(404, 'NOT_FOUND', '스냅샷을 찾을 수 없습니다.')
  const snapshot = await prisma.fileSnapshot.findFirst({
    where: { id: snapshotId, fileId, file: { projectId } },
    include: { createdBy: { select: { username: true } }, file: { include: { document: true } } },
  })
  if (!snapshot) throw new HttpError(404, 'NOT_FOUND', '스냅샷을 찾을 수 없습니다.')
  return snapshot
}
