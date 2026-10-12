import { prisma } from '@livebrary/database'
import { decryptString, encryptionKeyFrom } from '@livebrary/database/crypto'
import { loadProjectEnv } from '@livebrary/database/load-env'
import { weekStart } from '@livebrary/shared'

loadProjectEnv()

const secret = process.env.ADMIN_CODE_ENCRYPTION_KEY
if (!secret) throw new Error('ADMIN_CODE_ENCRYPTION_KEY is required')
const row = await prisma.adminAccessCode.findUnique({ where: { weekStart: weekStart() } })
if (!row) {
  console.error('No weekly code exists for the current week. Start the API once so rotation can run.')
  process.exitCode = 1
} else {
  process.stdout.write(`${decryptString(row.encryptedCode, encryptionKeyFrom(secret))}\n`)
}
await prisma.$disconnect()
