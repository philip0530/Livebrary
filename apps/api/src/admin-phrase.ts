import { prisma } from '@livebrary/database'
import { verifySecret } from '@livebrary/database/password'
import { weekStart } from '@livebrary/shared'

export type AdminPhraseVia = 'weekly' | 'fallback'

export function normalizePhrase(value: unknown): string | null {
  const phrase = String(value ?? '').trim().toLowerCase()
  if (!phrase || phrase.length > 64 || /\s/.test(phrase)) return null
  return phrase
}

export async function matchAdminPhrase(phrase: string): Promise<AdminPhraseVia | null> {
  const current = await prisma.adminAccessCode.findUnique({ where: { weekStart: weekStart() } })
  if (current && current.status === 'ACTIVE' && current.expiresAt > new Date() && await verifySecret(current.codeHash, phrase)) {
    return 'weekly'
  }
  const fallback = await prisma.adminFallbackCredential.findFirst({ where: { isActive: true }, orderBy: { updatedAt: 'desc' } })
  if (fallback && await verifySecret(fallback.codeHash, phrase)) return 'fallback'
  return null
}
