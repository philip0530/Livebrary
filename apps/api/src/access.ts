import { prisma } from '@livebrary/database'
import { canManage, canRestore, canWrite, effectiveRole, isUuid } from '@livebrary/shared'
import { HttpError } from './http.js'

export async function projectAccess(userId: string, projectId: string) {
  if (!isUuid(projectId)) throw new HttpError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.')
  const project = await prisma.project.findUnique({ where: { id: projectId } })
  if (!project) throw new HttpError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.')
  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
  })
  const role = effectiveRole(member?.role ?? null, project.visibility)
  if (!role) throw new HttpError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.')
  return { project, member, role }
}

export async function requireAccess(
  userId: string,
  projectId: string,
  mode: 'read' | 'write' | 'manage' | 'restore',
) {
  const access = await projectAccess(userId, projectId)
  if (mode === 'write' && !canWrite(access.role)) throw new HttpError(403, 'FORBIDDEN', '수정 권한이 없습니다.')
  if (mode === 'manage' && !canManage(access.role)) throw new HttpError(403, 'FORBIDDEN', '관리 권한이 없습니다.')
  if (mode === 'restore' && !canRestore(access.role)) throw new HttpError(403, 'FORBIDDEN', '복원 권한이 없습니다.')
  return access
}
