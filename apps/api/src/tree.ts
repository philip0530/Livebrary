import { prisma } from '@livebrary/database'
import { safeNameError } from '@livebrary/shared'
import { HttpError } from './http.js'

export async function filePath(fileId: string): Promise<string> {
  const names: string[] = []
  let currentId: string | null = fileId
  const guard = new Set<string>()
  while (currentId) {
    if (guard.has(currentId)) break
    guard.add(currentId)
    const row: { name: string; parentId: string | null } | null = await prisma.projectFile.findUnique({
      where: { id: currentId },
      select: { name: true, parentId: true },
    })
    if (!row) break
    names.push(row.name)
    currentId = row.parentId
  }
  return names.reverse().join('/')
}

export async function assertUniqueName(projectId: string, parentId: string | null, name: string, exceptId?: string) {
  const nameError = safeNameError(name)
  if (nameError) throw new HttpError(400, 'VALIDATION', nameError)
  const siblings = await prisma.projectFile.findMany({ where: { projectId, parentId } })
  if (siblings.some((item) => item.id !== exceptId && item.name.toLowerCase() === name.toLowerCase())) {
    throw new HttpError(409, 'CONFLICT', '같은 위치에 같은 이름이 있습니다.')
  }
}

export async function assertFolderParent(projectId: string, parentId: string | null) {
  if (!parentId) return
  const parent = await prisma.projectFile.findFirst({ where: { id: parentId, projectId } })
  if (!parent || parent.type !== 'FOLDER') throw new HttpError(400, 'VALIDATION', '폴더를 찾을 수 없습니다.')
}

export async function assertNoCycle(fileId: string, parentId: string | null) {
  let current: string | null = parentId
  const guard = new Set<string>()
  while (current) {
    if (current === fileId) throw new HttpError(400, 'VALIDATION', '폴더를 자신의 하위로 이동할 수 없습니다.')
    if (guard.has(current)) break
    guard.add(current)
    const row: { parentId: string | null } | null = await prisma.projectFile.findUnique({
      where: { id: current },
      select: { parentId: true },
    })
    current = row?.parentId ?? null
  }
}

export async function deleteTree(fileId: string): Promise<string[]> {
  const removed: string[] = []
  async function walk(id: string): Promise<void> {
    const children = await prisma.projectFile.findMany({ where: { parentId: id }, select: { id: true, type: true } })
    for (const child of children) await walk(child.id)
    const row = await prisma.projectFile.findUnique({ where: { id }, select: { type: true } })
    if (row?.type === 'FILE') removed.push(id)
    await prisma.projectFile.delete({ where: { id } })
  }
  await walk(fileId)
  return removed
}
