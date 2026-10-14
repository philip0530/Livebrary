import { randomToken, sha256 } from '@livebrary/database/crypto'

export type AdminChallenge = {
  via: 'weekly' | 'riyan' | 'fallback'
  exp: number
}

export type DiscordApprovalStatus = 'pending' | 'approved' | 'denied'

type DiscordApproval = {
  userId: string
  sessionKey: string
  status: DiscordApprovalStatus
  exp: number
}

export const PRE_ADMIN_MS = 10 * 60 * 1000
export const ADMIN_CHALLENGE_MS = 10 * 60 * 1000
export const DISCORD_QR_MS = 2 * 60 * 1000

const pending = new Map<string, AdminChallenge>()
const preAdmin = new Map<string, AdminChallenge>()
const approvals = new Map<string, DiscordApproval>()
const approvalByUser = new Map<string, string>()

function sweep(map: Map<string, { exp: number }>): void {
  const now = Date.now()
  for (const [key, row] of map) if (row.exp < now) map.delete(key)
}

export function setChallenge(userId: string, via: AdminChallenge['via']): void {
  pending.set(userId, { via, exp: Date.now() + ADMIN_CHALLENGE_MS })
}

export function getChallenge(userId: string): AdminChallenge | null {
  const row = pending.get(userId)
  if (!row || row.exp < Date.now()) {
    pending.delete(userId)
    return null
  }
  return row
}

export function clearChallenge(userId: string): void {
  pending.delete(userId)
  clearDiscordApproval(userId)
}

/** Issued on the black screen after a valid admin phrase; redeemed once after login. */
export function issuePreAdmin(via: AdminChallenge['via']): string {
  sweep(preAdmin)
  const token = randomToken()
  preAdmin.set(sha256(token), { via, exp: Date.now() + PRE_ADMIN_MS })
  return token
}

export function redeemPreAdmin(token: string | undefined): AdminChallenge['via'] | null {
  if (!token) return null
  const key = sha256(token)
  const row = preAdmin.get(key)
  preAdmin.delete(key)
  if (!row || row.exp < Date.now()) return null
  return row.via
}

/** One QR per admin login; the returned token is the OAuth `state`. */
export function startDiscordApproval(userId: string, sessionKey: string): { state: string; expiresAt: Date } {
  sweep(approvals)
  clearDiscordApproval(userId)
  const state = randomToken()
  const exp = Date.now() + DISCORD_QR_MS
  approvals.set(sha256(state), { userId, sessionKey, status: 'pending', exp })
  approvalByUser.set(userId, sha256(state))
  return { state, expiresAt: new Date(exp) }
}

export function pendingDiscordApproval(state: string | undefined): { userId: string } | null {
  if (!state) return null
  const row = approvals.get(sha256(state))
  if (!row || row.exp < Date.now() || row.status !== 'pending') return null
  return { userId: row.userId }
}

export function settleDiscordApproval(state: string, status: Exclude<DiscordApprovalStatus, 'pending'>): void {
  const row = approvals.get(sha256(state))
  if (row && row.status === 'pending') row.status = status
}

export function pollDiscordApproval(userId: string, sessionKey: string): DiscordApprovalStatus | 'expired' | 'none' {
  const key = approvalByUser.get(userId)
  const row = key ? approvals.get(key) : undefined
  if (!row || row.sessionKey !== sessionKey) return 'none'
  if (row.status === 'pending' && row.exp < Date.now()) return 'expired'
  return row.status
}

export function clearDiscordApproval(userId: string): void {
  const key = approvalByUser.get(userId)
  if (key) approvals.delete(key)
  approvalByUser.delete(userId)
}
