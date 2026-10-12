import { Prisma, prisma } from '@livebrary/database'
import { decryptString, encryptString, encryptionKeyFrom } from '@livebrary/database/crypto'
import { hashSecret } from '@livebrary/database/password'
import { keywordHash, pickWeeklyKeyword } from '@livebrary/shared/keywords'
import { nextWeekStart, weekStart } from '@livebrary/shared'
import { recordAudit } from './audit.js'
import { sendWeeklyCode } from './bot.js'

function key(): Buffer {
  const secret = process.env.ADMIN_CODE_ENCRYPTION_KEY
  if (!secret) throw new Error('ADMIN_CODE_ENCRYPTION_KEY is required')
  return encryptionKeyFrom(secret)
}

function isUnique(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function safeError(error: unknown, secret: string): string {
  const message = error instanceof Error ? error.message : 'discord publish failed'
  return message.split(secret).join('[redacted]').slice(0, 200)
}

export async function ensureWeeklyCode(): Promise<void> {
  const start = weekStart()
  const expires = nextWeekStart(start)
  await prisma.adminAccessCode.updateMany({
    where: { status: 'ACTIVE', weekStart: { lt: start } },
    data: { status: 'EXPIRED' },
  })
  const existing = await prisma.adminAccessCode.findUnique({ where: { weekStart: start } })
  if (!existing) {
    const recent = await prisma.adminAccessCode.findMany({
      orderBy: { weekStart: 'desc' },
      take: 12,
      select: { dictionaryHash: true },
    })
    const word = pickWeeklyKeyword(recent.map((row) => row.dictionaryHash)).toLowerCase()
    try {
      await prisma.adminAccessCode.create({
        data: {
          weekStart: start,
          expiresAt: expires,
          codeHash: await hashSecret(word),
          encryptedCode: encryptString(word, key()),
          dictionaryHash: keywordHash(word),
          status: 'ACTIVE',
        },
      })
      await recordAudit({
        eventType: 'ADMIN_CODE_ROTATED',
        result: 'SUCCESS',
        resourceType: 'admin-code',
        metadata: { weekStart: start.toISOString() },
      })
    } catch (error) {
      if (!isUnique(error)) throw error
    }
  }
  await publishWeeklyCode()
}

export async function reissueWeeklyCode(): Promise<void> {
  const start = weekStart()
  const expires = nextWeekStart(start)
  const recent = await prisma.adminAccessCode.findMany({
    orderBy: { weekStart: 'desc' },
    take: 12,
    select: { dictionaryHash: true },
  })
  const word = pickWeeklyKeyword(recent.map((row) => row.dictionaryHash)).toLowerCase()
  const data = {
    codeHash: await hashSecret(word),
    encryptedCode: encryptString(word, key()),
    dictionaryHash: keywordHash(word),
    status: 'ACTIVE' as const,
    publishedAt: null,
    publishAttempts: 0,
    publishError: '',
    issuedAt: new Date(),
    expiresAt: expires,
  }
  await prisma.adminAccessCode.upsert({
    where: { weekStart: start },
    create: { weekStart: start, ...data },
    update: data,
  })
  await recordAudit({
    eventType: 'ADMIN_CODE_ROTATED',
    result: 'SUCCESS',
    resourceType: 'admin-code',
    metadata: { weekStart: start.toISOString(), source: 'manual' },
  })
  await publishWeeklyCode()
}

export async function publishWeeklyCode(): Promise<void> {
  const start = weekStart()
  const row = await prisma.adminAccessCode.findUnique({ where: { weekStart: start } })
  if (!row || row.status !== 'ACTIVE' || row.publishedAt) return
  if (process.env.DISCORD_LOG_ENABLED !== 'true' || !process.env.DISCORD_BOT_TOKEN) return
  let plain = ''
  try {
    plain = decryptString(row.encryptedCode, key())
    await sendWeeklyCode(row.issuedAt, row.expiresAt, plain)
    await prisma.adminAccessCode.update({
      where: { id: row.id },
      data: { publishedAt: new Date(), publishError: '' },
    })
    await recordAudit({
      eventType: 'ADMIN_CODE_PUBLISHED',
      result: 'SUCCESS',
      resourceType: 'admin-code',
      metadata: { weekStart: start.toISOString() },
    })
  } catch (error) {
    const message = safeError(error, plain)
    if (row.publishAttempts === 0) {
      await recordAudit({
        eventType: 'ADMIN_CODE_PUBLISH_FAILED',
        result: 'FAILURE',
        resourceType: 'admin-code',
        metadata: { weekStart: start.toISOString(), reason: message },
      })
    }
    await prisma.adminAccessCode.update({
      where: { id: row.id },
      data: { publishAttempts: { increment: 1 }, publishError: message },
    })
  }
}

export function startRotation(): () => void {
  void ensureWeeklyCode().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'weekly code rotation failed')
  })
  const timer = setInterval(() => {
    void ensureWeeklyCode().catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'weekly code rotation failed')
    })
  }, 60_000)
  timer.unref?.()
  return () => clearInterval(timer)
}
