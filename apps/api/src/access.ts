import { prisma } from '@livebrary/database'
import { recordAudit } from '@livebrary/discord-logger'
import { canManage, canRestore, canWrite, effectiveRole, isUuid } from '@livebrary/shared'
import { HttpError } from './http.js'

async function denied(userId: string, projectId: string, stage: string, reason: string) {
  await recordAudit({ eventType: 'ACCESS_DENIED', actorId: userId, projectId, resourceType: 'project', resourceId: projectId, result: 'DENIED', metadata: { stage, reason } })
}

export async function projectAccess(userId: string, projectId: string) {
  if (!isUuid(projectId)) throw new HttpError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.')
  const project = await prisma.project.findUnique({ where: { id: projectId } })
  if (!project) throw new HttpError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.')
  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
  })
  const role = effectiveRole(member?.role ?? null, project.visibility)
  if (!role) {
    await denied(userId, projectId, 'project', 'private project, not a member')
    throw new HttpError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.')
  }
  return { project, member, role }
}

export async function requireAccess(
  userId: string,
  projectId: string,
  mode: 'read' | 'write' | 'manage' | 'restore',
) {
  const access = await projectAccess(userId, projectId)
  const allowed = mode === 'read'
    || (mode === 'write' && canWrite(access.role))
    || (mode === 'manage' && canManage(access.role))
    || (mode === 'restore' && canRestore(access.role))
  if (!allowed) {
    await denied(userId, projectId, mode, `role ${access.role}`)
    if (mode === 'write') throw new HttpError(403, 'FORBIDDEN', '수정 권한이 없습니다.')
    if (mode === 'manage') throw new HttpError(403, 'FORBIDDEN', '관리 권한이 없습니다.')
    throw new HttpError(403, 'FORBIDDEN', '복원 권한이 없습니다.')
  }
  return access
}
