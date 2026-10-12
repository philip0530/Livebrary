import { EmbedBuilder } from 'discord.js'
import { discordTone, formatKst } from '@livebrary/shared'

const COLORS = {
  success: 0x7bd88f,
  info: 0x6ca0ff,
  warn: 0xf4c76b,
  security: 0xff6b6b,
} as const

const ALLOWED = new Set([
  'username',
  'filePath',
  'editors',
  'from',
  'to',
  'status',
  'visibility',
  'role',
  'template',
  'projectName',
  'reason',
  'email',
  'ip',
  'weekStart',
  'source',
  'name',
])

type AuditRow = {
  eventType: string
  result: string
  resourceType: string
  resourceId: string
  metadata: unknown
  createdAt: Date
  actor: { username: string } | null
  project: { name: string } | null
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function field(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ').slice(0, 1000)
  if (value instanceof Date) return formatKst(value)
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return formatKst(parsed)
  }
  return String(value ?? '').slice(0, 1000)
}

export function embedForAudit(row: AuditRow, channelKey: string): EmbedBuilder {
  const tone = discordTone(row.eventType, row.result)
  const meta = asRecord(row.metadata)
  const embed = new EmbedBuilder()
    .setColor(COLORS[tone])
    .setTitle(`[${row.eventType}]`)
    .setTimestamp(row.createdAt)
  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: 'USER', value: (row.actor?.username ?? field(meta.username)) || 'SYSTEM', inline: true },
    { name: 'PROJECT', value: (row.project?.name ?? field(meta.projectName)) || '—', inline: true },
    { name: 'EVENT', value: row.eventType, inline: true },
    { name: 'RESULT', value: row.result, inline: true },
    { name: 'TIME', value: formatKst(row.createdAt), inline: false },
  ]
  if (meta.filePath) fields.push({ name: 'FILE', value: field(meta.filePath) })
  if (meta.editors) fields.push({ name: 'EDITORS', value: field(meta.editors) })
  if (meta.from || meta.to) fields.push({ name: 'TIME RANGE', value: `${field(meta.from)} ~ ${field(meta.to)}` })
  if (meta.status) fields.push({ name: 'STATUS', value: field(meta.status), inline: true })
  if (channelKey === 'security') {
    if (meta.email) fields.push({ name: 'EMAIL', value: field(meta.email), inline: true })
    if (meta.ip) fields.push({ name: 'IP', value: field(meta.ip), inline: true })
    if (meta.reason) fields.push({ name: 'REASON', value: field(meta.reason) })
  }
  for (const [key, value] of Object.entries(meta)) {
    if (!ALLOWED.has(key)) continue
    if (['username', 'filePath', 'editors', 'from', 'to', 'status', 'projectName', 'email', 'ip', 'reason'].includes(key)) continue
    if (value == null || value === '') continue
    fields.push({ name: key.toUpperCase(), value: field(value), inline: true })
  }
  embed.addFields(fields.slice(0, 20))
  return embed
}

export function weeklyCodeMessage(issuedAt: Date, expiresAt: Date, code: string): string {
  return [
    'LIVEBRARY — WEEKLY ACCESS CODE',
    '',
    'ISSUED AT:',
    formatKst(issuedAt),
    '',
    'EXPIRES AT:',
    formatKst(expiresAt),
    '',
    'ACCESS CODE:',
    `\`${code}\``,
    '',
    'STATUS: ACTIVE',
    '',
    'ISSUER: LIVEBRARY SYSTEM',
  ].join('\n')
}
