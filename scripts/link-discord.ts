import { loadProjectEnv } from '@livebrary/database/load-env'

loadProjectEnv()

const { Prisma, prisma } = await import('@livebrary/database')
const { recordAudit } = await import('@livebrary/discord-logger')

const [usernameArg, discordArg] = process.argv.slice(2)
const username = usernameArg?.trim().toLowerCase()
const discordId = discordArg?.trim()
const unlink = discordId === '--unlink'

if (!username || !discordId || (!unlink && !/^\d{17,20}$/.test(discordId))) {
  console.error('usage: npm run admin:discord -- <username> <discord user id>')
  console.error('       npm run admin:discord -- <username> --unlink')
  process.exit(1)
}

const user = await prisma.user.findUnique({ where: { usernameNormalized: username } })
if (!user) {
  console.error(`no account named ${username}`)
  process.exitCode = 1
} else if (user.systemRole !== 'SYSTEM_ADMIN') {
  console.error(`${user.username} is not SYSTEM_ADMIN. Run npm run admin:grant -- ${user.username} first.`)
  process.exitCode = 1
} else {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: unlink ? { discordUserId: null, discordLinkedAt: null } : { discordUserId: discordId, discordLinkedAt: new Date() },
      })
      await tx.adminSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } })
      await recordAudit({
        eventType: 'ADMIN_DISCORD_LINKED',
        resourceType: 'user',
        resourceId: user.id,
        result: 'SUCCESS',
        metadata: { username: user.username, discord: unlink ? 'unlinked' : `…${discordId.slice(-4)}`, source: 'server-cli' },
      }, tx)
    })
    console.log(unlink ? `${user.username}: Discord unlinked` : `${user.username}: linked to Discord user ${discordId}`)
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      console.error('that Discord account is already linked to another Livebrary account')
      process.exitCode = 1
    } else {
      throw error
    }
  }
}
await prisma.$disconnect()
