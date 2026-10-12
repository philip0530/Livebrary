export type ProjectRoleName = 'OWNER' | 'EDITOR' | 'VIEWER'
export type VisibilityName = 'PRIVATE' | 'PUBLIC'

export function canRead(role: ProjectRoleName | null, visibility: VisibilityName): boolean {
  if (role) return true
  return visibility === 'PUBLIC'
}

export function canWrite(role: ProjectRoleName | null): boolean {
  return role === 'OWNER' || role === 'EDITOR'
}

export function canManage(role: ProjectRoleName | null): boolean {
  return role === 'OWNER'
}

export function canRestore(role: ProjectRoleName | null): boolean {
  return role === 'OWNER' || role === 'EDITOR'
}

export function canChat(role: ProjectRoleName | null, visibility: VisibilityName): boolean {
  return canRead(role, visibility)
}

export function effectiveRole(role: ProjectRoleName | null, visibility: VisibilityName): ProjectRoleName | null {
  if (role) return role
  if (visibility === 'PUBLIC') return 'VIEWER'
  return null
}
