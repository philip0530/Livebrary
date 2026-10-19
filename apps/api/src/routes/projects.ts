import { Router } from 'express'
import JSZip from 'jszip'
import { prisma } from '@livebrary/database'
import { recordAudit } from '@livebrary/discord-logger'
import { decodeTextState, encodeTextState } from '@livebrary/shared/yjs-text'
import {
  DEFAULT_CHANNELS,
  isUuid,
  safeZipPathError,
  templateFiles,
  validateProjectName,
  languageFromName,
} from '@livebrary/shared'
import { requireAccess } from '../access.js'
import { collaboration } from '../collab-registry.js'
import { closeProject, closeProjectUser } from '../hub.js'
import { HttpError, contentDisposition, routeParam, wrap } from '../http.js'

async function summaries(userId: string) {
  const memberships = await prisma.projectMember.findMany({
    where: { userId },
    include: { project: { include: { _count: { select: { members: true } } } } },
    orderBy: { project: { updatedAt: 'desc' } },
  })
  const map = memberships.map((item) => ({
    id: item.project.id,
    name: item.project.name,
    description: item.project.description,
    visibility: item.project.visibility,
    updatedAt: item.project.updatedAt,
    role: item.role,
    memberCount: item.project._count.members,
    lastOpenedAt: item.lastOpenedAt,
  }))
  return {
    owned: map.filter((item) => item.role === 'OWNER'),
    participating: map.filter((item) => item.role !== 'OWNER'),
    recent: [...map].filter((item) => item.lastOpenedAt).sort((a, b) => +new Date(b.lastOpenedAt ?? 0) - +new Date(a.lastOpenedAt ?? 0)).slice(0, 8),
  }
}

export function projectRouter(): Router {
  const router = Router()

  router.get('/', wrap(async (req, res) => {
    res.json(await summaries(req.user!.id))
  }))

  router.post('/', wrap(async (req, res) => {
    const body = req.body as { name?: string; description?: string; visibility?: string; template?: string }
    const name = body.name?.trim() ?? ''
    const nameError = validateProjectName(name)
    if (nameError) throw new HttpError(400, 'VALIDATION', nameError)
    const description = (body.description ?? '').trim()
    if (description.length > 500) throw new HttpError(400, 'VALIDATION', '설명은 500자 이하여야 합니다.')
    const visibility = body.visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE'
    const files = templateFiles(body.template ?? 'empty')
    if (!files) throw new HttpError(400, 'VALIDATION', '프로젝트 템플릿을 확인할 수 없습니다.')
    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: { ownerId: req.user!.id, name, description, visibility },
      })
      await tx.projectMember.create({ data: { projectId: created.id, userId: req.user!.id, role: 'OWNER' } })
      for (const channel of DEFAULT_CHANNELS) {
        await tx.chatChannel.create({ data: { projectId: created.id, name: channel } })
      }
      const folders = new Map<string, string>()
      for (const file of files) {
        const parts = file.path.split('/')
        const fileName = parts.pop()
        if (!fileName) continue
        let parentId: string | null = null
        let walked = ''
        for (const folder of parts) {
          walked = walked ? `${walked}/${folder}` : folder
          const existing = folders.get(walked)
          if (existing) {
            parentId = existing
            continue
          }
          const folderRow: { id: string } = await tx.projectFile.create({
            data: { projectId: created.id, parentId, name: folder, type: 'FOLDER' },
          })
          folders.set(walked, folderRow.id)
          parentId = folderRow.id
        }
        const row = await tx.projectFile.create({
          data: { projectId: created.id, parentId, name: fileName, type: 'FILE', language: languageFromName(fileName) },
        })
        await tx.collaborativeDocument.create({
          data: { projectId: created.id, fileId: row.id, yjsState: encodeTextState(file.content) },
        })
      }
      await recordAudit({
        eventType: 'PROJECT_CREATED',
        actorId: req.user!.id,
        projectId: created.id,
        resourceType: 'project',
        resourceId: created.id,
        result: 'SUCCESS',
        metadata: { name, visibility, template: body.template ?? 'empty' },
      }, tx)
      return created
    })
    res.status(201).json({ project })
  }))

  router.get('/:id', wrap(async (req, res) => {
    const access = await requireAccess(req.user!.id, routeParam(req.params.id), 'read')
    const memberCount = await prisma.projectMember.count({ where: { projectId: access.project.id } })
    res.json({
      project: {
        id: access.project.id,
        name: access.project.name,
        description: access.project.description,
        visibility: access.project.visibility,
        ownerId: access.project.ownerId,
        createdAt: access.project.createdAt,
        updatedAt: access.project.updatedAt,
        role: access.role,
        memberCount,
      },
    })
  }))

  router.post('/:id/open', wrap(async (req, res) => {
    const access = await requireAccess(req.user!.id, routeParam(req.params.id), 'read')
    if (access.member) {
      await prisma.projectMember.update({ where: { id: access.member.id }, data: { lastOpenedAt: new Date() } })
    }
    await recordAudit({
      eventType: 'PROJECT_ENTERED',
      actorId: req.user!.id,
      projectId: access.project.id,
      resourceType: 'project',
      resourceId: access.project.id,
      result: 'SUCCESS',
      metadata: { name: access.project.name, role: access.role },
    })
    res.json({ ok: true })
  }))

  router.post('/:id/join', wrap(async (req, res) => {
    const projectId = routeParam(req.params.id)
    if (!isUuid(projectId)) throw new HttpError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.')
    const project = await prisma.project.findUnique({ where: { id: projectId } })
    if (!project) throw new HttpError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.')
    const existing = await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: req.user!.id } } })
    if (!existing && project.visibility !== 'PUBLIC') throw new HttpError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.')
    if (!existing) {
      await prisma.projectMember.create({ data: { projectId, userId: req.user!.id, role: 'VIEWER', lastOpenedAt: new Date() } })
    }
    await recordAudit({
      eventType: 'PROJECT_ENTERED',
      actorId: req.user!.id,
      projectId,
      resourceType: 'project',
      resourceId: projectId,
      result: 'SUCCESS',
      metadata: { name: project.name },
    })
    res.json({ projectId })
  }))

  router.post('/:id/leave', wrap(async (req, res) => {
    const access = await requireAccess(req.user!.id, routeParam(req.params.id), 'read')
    if (access.role === 'OWNER') throw new HttpError(400, 'VALIDATION', '소유자는 프로젝트에서 나갈 수 없습니다. 프로젝트를 삭제하세요.')
    if (access.member) await prisma.projectMember.delete({ where: { id: access.member.id } })
    collaboration()?.disconnectUser(req.user!.id, access.project.id)
    closeProjectUser(req.user!.id, access.project.id)
    res.json({ ok: true })
  }))

  router.patch('/:id', wrap(async (req, res) => {
    const access = await requireAccess(req.user!.id, routeParam(req.params.id), 'manage')
    const body = req.body as { name?: string; description?: string; visibility?: string }
    const data: { name?: string; description?: string; visibility?: 'PRIVATE' | 'PUBLIC' } = {}
    if (body.name !== undefined) {
      const name = body.name.trim()
      const error = validateProjectName(name)
      if (error) throw new HttpError(400, 'VALIDATION', error)
      data.name = name
    }
    if (body.description !== undefined) {
      if (body.description.trim().length > 500) throw new HttpError(400, 'VALIDATION', '설명은 500자 이하여야 합니다.')
      data.description = body.description.trim()
    }
    if (body.visibility !== undefined) {
      if (body.visibility !== 'PRIVATE' && body.visibility !== 'PUBLIC') throw new HttpError(400, 'VALIDATION', '공개 범위가 올바르지 않습니다.')
      data.visibility = body.visibility
    }
    const project = await prisma.project.update({ where: { id: access.project.id }, data })
    await recordAudit({
      eventType: data.visibility && data.visibility !== access.project.visibility ? 'VISIBILITY_CHANGED' : 'PROJECT_UPDATED',
      actorId: req.user!.id,
      projectId: project.id,
      resourceType: 'project',
      resourceId: project.id,
      result: 'SUCCESS',
      metadata: { name: project.name, visibility: project.visibility },
    })
    res.json({ project })
  }))

  router.delete('/:id', wrap(async (req, res) => {
    const access = await requireAccess(req.user!.id, routeParam(req.params.id), 'manage')
    collaboration()?.closeProject(access.project.id)
    closeProject(access.project.id)
    await prisma.project.delete({ where: { id: access.project.id } })
    await recordAudit({
      eventType: 'PROJECT_DELETED',
      actorId: req.user!.id,
      resourceType: 'project',
      resourceId: access.project.id,
      result: 'SUCCESS',
      metadata: { name: access.project.name },
    })
    res.json({ ok: true })
  }))

  router.get('/:id/export', wrap(async (req, res) => {
    const access = await requireAccess(req.user!.id, routeParam(req.params.id), 'read')
    const files = await prisma.projectFile.findMany({
      where: { projectId: access.project.id },
      include: { document: true },
    })
    const byId = new Map(files.map((file) => [file.id, file]))
    const zip = new JSZip()
    for (const file of files) {
      const names: string[] = []
      let current: (typeof file) | undefined = file
      const guard = new Set<string>()
      while (current) {
        if (guard.has(current.id)) break
        guard.add(current.id)
        names.push(current.name)
        current = current.parentId ? byId.get(current.parentId) : undefined
      }
      const path = names.reverse().join('/')
      if (safeZipPathError(path)) throw new HttpError(400, 'VALIDATION', '내보낼 수 없는 경로가 있습니다.')
      if (file.type === 'FOLDER') zip.folder(path)
      else zip.file(path, file.document ? decodeTextState(file.document.yjsState) : '')
    }
    const buffer = await zip.generateAsync({ type: 'nodebuffer' })
    const filename = `${access.project.name.replace(/[^\w.-]+/g, '_') || 'project'}.zip`
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', contentDisposition(filename))
    res.send(buffer)
  }))

  return router
}
