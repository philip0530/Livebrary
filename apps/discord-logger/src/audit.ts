import { Prisma, prisma } from '@livebrary/database'
import { discordChannelFor, redact } from '@livebrary/shared'

export type AuditInput = {
  eventType: string
  actorId?: string | null
  projectId?: string | null
  resourceType?: string
  resourceId?: string
  result: 'SUCCESS' | 'FAILURE' | 'DENIED'
  metadata?: Record<string, unknown>
}

type Writer = Prisma.TransactionClient | typeof prisma

export async function recordAudit(input: AuditInput, writer: Writer = prisma) {
  const metadata = redact(input.metadata ?? {}) as Prisma.InputJsonValue
  const row = await writer.auditLog.create({
    data: {
      eventType: input.eventType,
      actorId: input.actorId ?? null,
      projectId: input.projectId ?? null,
      resourceType: input.resourceType ?? '',
      resourceId: input.resourceId ?? '',
      result: input.result,
      metadata,
    },
  })
  await writer.discordLogQueue.create({
    data: {
      auditLogId: row.id,
      channelKey: discordChannelFor(input.eventType, input.result),
      payload: {},
      status: 'PENDING',
    },
  })
  return row
}
