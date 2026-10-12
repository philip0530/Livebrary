import { prisma } from '@livebrary/database'
import { sha256 } from '@livebrary/database/crypto'
import { notePersisted } from '@livebrary/discord-logger'
import type { CollabContext } from '@livebrary/collaboration'

const lastAuto = new Map<string, number>()
const lastTouch = new Map<string, number>()

export async function saveDocument(
  projectId: string,
  fileId: string,
  state: Uint8Array,
  text: string,
  context: CollabContext | null,
): Promise<void> {
  const bytes = Buffer.from(state)
  await prisma.collaborativeDocument.upsert({
    where: { fileId },
    update: { yjsState: bytes },
    create: { projectId, fileId, yjsState: bytes },
  })
  notePersisted(fileId)
  const now = Date.now()
  if (now - (lastTouch.get(fileId) ?? 0) > 30_000) {
    lastTouch.set(fileId, now)
    await prisma.projectFile.update({ where: { id: fileId }, data: { updatedAt: new Date() } }).catch(() => undefined)
    await prisma.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } }).catch(() => undefined)
  }
  if (now - (lastAuto.get(fileId) ?? 0) < 10 * 60 * 1000) return
  const hash = sha256(text)
  const previous = await prisma.fileSnapshot.findFirst({
    where: { fileId },
    orderBy: { createdAt: 'desc' },
    select: { contentHash: true },
  })
  lastAuto.set(fileId, now)
  if (previous?.contentHash === hash) return
  await prisma.fileSnapshot.create({
    data: {
      fileId,
      documentState: bytes,
      textSnapshot: text,
      contentHash: hash,
      kind: 'AUTO',
      createdById: context?.userId,
    },
  })
}
