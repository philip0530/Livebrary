export const AUDIT_EVENTS = [
  'GATE_ENTERED',
  'GATE_FAILED',
  'USER_REGISTERED',
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'PROFILE_UPDATED',
  'PROJECT_CREATED',
  'PROJECT_ENTERED',
  'PROJECT_UPDATED',
  'PROJECT_DELETED',
  'VISIBILITY_CHANGED',
  'FILE_CREATED',
  'FILE_DELETED',
  'FILE_RENAMED',
  'FILE_MOVED',
  'FOLDER_CREATED',
  'FOLDER_DELETED',
  'FILE_RESTORED',
  'SNAPSHOT_CREATED',
  'FILE_EDIT_SUMMARY',
  'MEMBER_INVITED',
  'INVITE_ACCEPTED',
  'INVITE_DECLINED',
  'PERMISSION_CHANGED',
  'MEMBER_REMOVED',
  'ACCESS_DENIED',
  'ADMIN_ENTRY',
  'ADMIN_CODE_ACCEPTED',
  'ADMIN_ACCESS_DENIED',
  'ADMIN_MFA_FAILED',
  'ADMIN_EXIT',
  'ADMIN_CODE_ROTATED',
  'ADMIN_CODE_PUBLISHED',
  'ADMIN_CODE_PUBLISH_FAILED',
  'ADMIN_FALLBACK_USED',
  'ADMIN_FALLBACK_ROTATED',
  'ADMIN_SETTINGS_CHANGED',
  'ADMIN_ROLE_GRANTED',
  'ADMIN_DISCORD_LINKED',
  'ADMIN_DISCORD_APPROVED',
  'ACCOUNT_LIMITED',
  'ACCOUNT_UNLIMITED',
  'SESSIONS_REVOKED',
] as const

export type AuditEventName = (typeof AUDIT_EVENTS)[number]

const SECURITY = new Set<string>([
  'GATE_FAILED',
  'LOGIN_FAILED',
  'ACCESS_DENIED',
  'ADMIN_ENTRY',
  'ADMIN_CODE_ACCEPTED',
  'ADMIN_ACCESS_DENIED',
  'ADMIN_MFA_FAILED',
  'ADMIN_EXIT',
  'ADMIN_CODE_ROTATED',
  'ADMIN_CODE_PUBLISHED',
  'ADMIN_CODE_PUBLISH_FAILED',
  'ADMIN_FALLBACK_USED',
  'ADMIN_FALLBACK_ROTATED',
  'ADMIN_SETTINGS_CHANGED',
  'ADMIN_ROLE_GRANTED',
  'ADMIN_DISCORD_LINKED',
  'ADMIN_DISCORD_APPROVED',
  'ACCOUNT_LIMITED',
  'ACCOUNT_UNLIMITED',
  'SESSIONS_REVOKED',
])

export function discordChannelFor(eventType: string, result: string): 'activity' | 'security' {
  if (result !== 'SUCCESS' || SECURITY.has(eventType)) return 'security'
  return 'activity'
}

export type DiscordTone = 'success' | 'info' | 'warn' | 'security'

export function discordTone(eventType: string, result: string): DiscordTone {
  if (result !== 'SUCCESS') return 'security'
  if (eventType === 'ADMIN_ENTRY' || eventType === 'ADMIN_FALLBACK_USED') return 'warn'
  if (SECURITY.has(eventType)) return 'security'
  if (/UPDATED|DELETED|RESTORED|CHANGED|REMOVED|RENAMED|MOVED/.test(eventType)) return 'warn'
  if (/CREATED|REGISTERED|ENTERED|ACCEPTED|LOGIN$|GATE_ENTERED/.test(eventType)) return 'success'
  return 'info'
}
