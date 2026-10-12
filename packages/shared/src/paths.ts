const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID.test(value)
}

export function documentName(projectId: string, fileId: string): string {
  return `project:${projectId}:file:${fileId}`
}

export function parseDocumentName(name: string): { projectId: string; fileId: string } | null {
  const match = /^project:([0-9a-f-]{36}):file:([0-9a-f-]{36})$/i.exec(name)
  if (!match) return null
  const projectId = match[1] ?? ''
  const fileId = match[2] ?? ''
  if (!isUuid(projectId) || !isUuid(fileId)) return null
  return { projectId, fileId }
}

export function safeNameError(name: string): string | null {
  if (!name || name.length > 120) return '이름은 1~120자여야 합니다.'
  if (name !== name.trim()) return '이름의 앞뒤 공백은 허용되지 않습니다.'
  if (name === '.' || name === '..') return '이 이름은 사용할 수 없습니다.'
  if (/[/\\\u0000]/.test(name)) return '이름에 경로 구분자를 넣을 수 없습니다.'
  return null
}

export function safeZipPathError(filePath: string): string | null {
  if (!filePath || filePath.length > 500) return '경로가 올바르지 않습니다.'
  if (filePath.includes('\u0000')) return '경로가 올바르지 않습니다.'
  if (filePath.startsWith('/') || filePath.startsWith('\\') || /^[a-zA-Z]:/.test(filePath)) {
    return '절대 경로는 허용되지 않습니다.'
  }
  const parts = filePath.split('/')
  if (parts.length === 0 || parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\'))) {
    return '경로가 올바르지 않습니다.'
  }
  for (const part of parts) {
    if (safeNameError(part)) return '경로가 올바르지 않습니다.'
  }
  return null
}
