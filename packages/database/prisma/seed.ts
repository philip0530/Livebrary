import { prisma } from '../src/index.ts'
import { hashSecret } from '../src/password.ts'
import { loadProjectEnv } from '../src/load-env.ts'
import { validateEmail, validatePassword, validateUsername } from '@livebrary/shared'

loadProjectEnv()

const fallbackCode = process.env.ADMIN_FALLBACK_CODE?.trim() || 'Trust'

async function main(): Promise<void> {
  const activeFallback = await prisma.adminFallbackCredential.findFirst({ where: { isActive: true } })
  if (!activeFallback) {
    await prisma.adminFallbackCredential.create({
      data: { codeHash: await hashSecret(fallbackCode.toLowerCase()), isActive: true },
    })
    console.log('Fallback admin credential stored as a hash.')
  }

  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase() ?? ''
  const username = process.env.ADMIN_USERNAME?.trim() ?? ''
  const password = process.env.ADMIN_PASSWORD ?? ''
  if (!email && !username && !password) {
    console.log('Admin seed skipped. Set ADMIN_EMAIL, ADMIN_USERNAME, and ADMIN_PASSWORD to create the operator account.')
    return
  }
  const emailError = validateEmail(email)
  const usernameError = validateUsername(username)
  const passwordError = validatePassword(password, email, username)
  if (emailError || usernameError || passwordError) {
    console.error(`SEED FAILED: ${emailError ?? usernameError ?? passwordError}`)
    console.error('Admin account was not created. Use an email address, a username of 3-20 English letters, numbers, or underscores, and a password of 10-128 characters containing a letter and a number.')
    return
  }
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    if (existing.systemRole !== 'SYSTEM_ADMIN') {
      await prisma.user.update({ where: { id: existing.id }, data: { systemRole: 'SYSTEM_ADMIN' } })
      console.log(`Existing account promoted to SYSTEM_ADMIN: ${existing.username}`)
    } else {
      console.log(`Admin account already present: ${existing.username}`)
    }
    return
  }
  const user = await prisma.user.create({
    data: {
      email,
      username,
      usernameNormalized: username.toLowerCase(),
      passwordHash: await hashSecret(password),
      systemRole: 'SYSTEM_ADMIN',
      preference: { create: {} },
    },
  })
  await prisma.auditLog.create({
    data: {
      eventType: 'USER_REGISTERED',
      actorId: user.id,
      resourceType: 'user',
      resourceId: user.id,
      result: 'SUCCESS',
      metadata: { username: user.username, source: 'seed' },
    },
  })
  console.log(`System admin created: ${user.username}`)
}

main()
  .catch((error: unknown) => {
    console.error('SEED FAILED')
    console.error(error instanceof Error ? error.stack ?? error.message : error)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
