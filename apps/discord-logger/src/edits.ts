import { recordAudit } from './audit.js'

type Bucket = {
  projectId: string
  projectName: string
  fileId: string
  filePath: string
  editors: Map<string, string>
  start: number
  end: number
  persisted: boolean
}

const buckets = new Map<string, Bucket>()

export function noteEdit(input: {
  projectId: string
  projectName: string
  fileId: string
  filePath: string
  userId: string
  username: string
}): void {
  const existing = buckets.get(input.fileId)
  if (!existing) {
    buckets.set(input.fileId, {
      projectId: input.projectId,
      projectName: input.projectName,
      fileId: input.fileId,
      filePath: input.filePath,
      editors: new Map([[input.userId, input.username]]),
      start: Date.now(),
      end: Date.now(),
      persisted: false,
    })
    return
  }
  existing.editors.set(input.userId, input.username)
  existing.end = Date.now()
  existing.filePath = input.filePath
  existing.projectName = input.projectName
}

export function notePersisted(fileId: string): void {
  const bucket = buckets.get(fileId)
  if (bucket) bucket.persisted = true
}

export async function flushEdits(force = false): Promise<void> {
  const windowMs = Math.max(5, Number(process.env.DISCORD_LOG_AGGREGATION_SECONDS ?? 30)) * 1000
  const now = Date.now()
  const ready = [...buckets.entries()].filter(([, bucket]) => bucket.persisted && (force || now - bucket.start >= windowMs))
  for (const [key, bucket] of ready) {
    buckets.delete(key)
    await recordAudit({
      eventType: 'FILE_EDIT_SUMMARY',
      projectId: bucket.projectId,
      resourceType: 'file',
      resourceId: bucket.fileId,
      result: 'SUCCESS',
      metadata: {
        projectName: bucket.projectName,
        filePath: bucket.filePath,
        editors: [...bucket.editors.values()],
        from: new Date(bucket.start).toISOString(),
        to: new Date(bucket.end).toISOString(),
        status: 'PERSISTED',
      },
    })
  }
}

export function startEditFlusher(): () => void {
  const timer = setInterval(() => {
    void flushEdits().catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'edit flush failed')
    })
  }, 5000)
  timer.unref?.()
  return () => clearInterval(timer)
}
