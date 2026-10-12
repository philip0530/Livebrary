import { prisma } from '@livebrary/database'
import { recordAudit } from './audit.js'
import { sendEmbed } from './bot.js'
import { embedForAudit } from './embeds.js'

function nextDelay(attempts: number): number {
  return Math.min(60 * 60 * 1000, 15_000 * 2 ** Math.min(attempts, 6))
}

export async function processDiscordQueue(): Promise<void> {
  const rows = await prisma.discordLogQueue.findMany({
    where: { status: 'PENDING', nextRetryAt: { lte: new Date() } },
    orderBy: { createdAt: 'asc' },
    take: 20,
    include: {
      auditLog: {
        include: {
          actor: { select: { username: true } },
          project: { select: { name: true } },
        },
      },
    },
  })
  for (const row of rows) {
    if (process.env.DISCORD_LOG_ENABLED !== 'true') {
      await prisma.discordLogQueue.update({
        where: { id: row.id },
        data: { status: 'SKIPPED', lastError: 'disabled' },
      })
      continue
    }
    if (!process.env.DISCORD_BOT_TOKEN) {
      await prisma.discordLogQueue.update({
        where: { id: row.id },
        data: { nextRetryAt: new Date(Date.now() + 60_000), lastError: 'not configured' },
      })
      continue
    }
    if (!row.auditLog || (row.channelKey !== 'activity' && row.channelKey !== 'security')) {
      await prisma.discordLogQueue.update({
        where: { id: row.id },
        data: { status: 'FAILED', lastError: 'invalid queue row' },
      })
      continue
    }
    try {
      await sendEmbed(row.channelKey, embedForAudit(row.auditLog, row.channelKey))
      await prisma.discordLogQueue.update({
        where: { id: row.id },
        data: { status: 'SENT', sentAt: new Date(), lastError: '' },
      })
    } catch (error) {
      const attempts = row.attempts + 1
      await prisma.discordLogQueue.update({
        where: { id: row.id },
        data: {
          attempts,
          status: attempts >= 8 ? 'FAILED' : 'PENDING',
          nextRetryAt: new Date(Date.now() + nextDelay(attempts)),
          lastError: error instanceof Error ? error.message.slice(0, 200) : 'send failed',
        },
      })
    }
  }
}

export function startDiscordQueue(): () => void {
  const timer = setInterval(() => {
    void processDiscordQueue().catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'discord queue failed')
    })
  }, 5000)
  timer.unref?.()
  return () => clearInterval(timer)
}

export async function queueDepth() {
  const [pending, failed] = await Promise.all([
    prisma.discordLogQueue.count({ where: { status: 'PENDING' } }),
    prisma.discordLogQueue.count({ where: { status: 'FAILED' } }),
  ])
  return { pending, failed }
}

export { recordAudit }
