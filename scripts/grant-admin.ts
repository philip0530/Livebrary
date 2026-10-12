import { loadProjectEnv } from '@livebrary/database/load-env'

loadProjectEnv()

const { prisma } = await import('@livebrary/database')
const { recordAudit } = await import('@livebrary/discord-logger')

const username = process.argv[2]?.trim().toLowerCase()
if (!username) {
  console.error('usage: npm run admin:grant -- <username>')
  process.exit(1)
}

const user = await prisma.user.findUnique({ where: { usernameNormalized: username } })
if (!user) {
  console.error(`no account named ${username}`)
  process.exitCode = 1
} else if (user.systemRole === 'SYSTEM_ADMIN') {
  console.log(`${user.username} is already SYSTEM_ADMIN`)
} else {
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { systemRole: 'SYSTEM_ADMIN' } })
    await tx.userSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } })
    await recordAudit({
      eventType: 'ADMIN_ROLE_GRANTED',
      resourceType: 'user',
      resourceId: user.id,
      result: 'SUCCESS',
      metadata: { username: user.username, source: 'server-cli' },
    }, tx)
  })
  console.log(`${user.username} is now SYSTEM_ADMIN. Existing sessions were signed out.`)
}
await prisma.$disconnect()
