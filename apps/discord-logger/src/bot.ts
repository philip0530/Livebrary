import { Client, EmbedBuilder, GatewayIntentBits } from 'discord.js'
import { prisma } from '@livebrary/database'
import { weeklyCodeMessage } from './embeds.js'
import { runtime } from './runtime.js'

let client: Client | null = null
let starting: Promise<void> | null = null

async function setting(key: string, fallback: string): Promise<string> {
  const row = await prisma.serviceSetting.findUnique({ where: { key } })
  const value = row?.value?.trim()
  return value || fallback
}

export function discordEnabled(): boolean {
  return process.env.DISCORD_LOG_ENABLED === 'true'
}

export async function channelId(key: 'activity' | 'security' | 'developer'): Promise<string> {
  if (key === 'activity') return setting('discord.activityChannelId', process.env.DISCORD_ACTIVITY_CHANNEL_ID ?? '')
  if (key === 'security') return setting('discord.securityChannelId', process.env.DISCORD_SECURITY_CHANNEL_ID ?? '')
  return setting('discord.developerCodeChannelId', process.env.DISCORD_DEVELOPER_CODE_CHANNEL_ID ?? '')
}

export async function startDiscord(): Promise<void> {
  if (!discordEnabled() || !process.env.DISCORD_BOT_TOKEN) {
    runtime.discordConnected = false
    return
  }
  if (client?.isReady()) return
  if (starting) return starting
  starting = (async () => {
    const next = new Client({ intents: [GatewayIntentBits.Guilds] })
    next.once('ready', () => {
      runtime.discordConnected = true
      runtime.discordLastError = ''
    })
    next.on('error', (error) => {
      runtime.discordConnected = false
      runtime.discordLastError = error.message.slice(0, 200)
    })
    try {
      await next.login(process.env.DISCORD_BOT_TOKEN)
      client = next
    } catch (error) {
      runtime.discordConnected = false
      runtime.discordLastError = error instanceof Error ? error.message.slice(0, 200) : 'discord login failed'
      throw error
    } finally {
      starting = null
    }
  })()
  return starting
}

export async function stopDiscord(): Promise<void> {
  runtime.discordConnected = false
  if (client) await client.destroy()
  client = null
}

async function sendTo(channelIdValue: string, payload: { content?: string; embeds?: EmbedBuilder[] }): Promise<void> {
  if (!client?.isReady()) await startDiscord()
  if (!client?.isReady()) throw new Error('Discord bot is not connected')
  const channel = await client.channels.fetch(channelIdValue)
  if (!channel || !channel.isTextBased() || channel.isDMBased() || !('send' in channel)) {
    throw new Error('Discord channel is not sendable')
  }
  await channel.send(payload)
  runtime.discordLastSentAt = new Date().toISOString()
  runtime.discordLastError = ''
}

export async function sendEmbed(key: 'activity' | 'security', embed: EmbedBuilder): Promise<void> {
  const id = await channelId(key)
  if (!id) throw new Error(`Discord ${key} channel is not configured`)
  await sendTo(id, { embeds: [embed] })
}

export async function sendTestMessage(): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0x7bd88f)
    .setTitle('[DISCORD TEST]')
    .setDescription('Livebrary activity channel test')
    .addFields({ name: 'TIME', value: new Date().toISOString() })
  await sendEmbed('activity', embed)
}

export async function sendWeeklyCode(issuedAt: Date, expiresAt: Date, code: string): Promise<void> {
  const id = await channelId('developer')
  if (!id) throw new Error('Discord developer code channel is not configured')
  await sendTo(id, { content: weeklyCodeMessage(issuedAt, expiresAt, code) })
}

export function discordStatus() {
  return {
    enabled: discordEnabled(),
    configured: Boolean(process.env.DISCORD_BOT_TOKEN),
    connected: runtime.discordConnected,
    lastError: runtime.discordLastError,
    lastSentAt: runtime.discordLastSentAt,
  }
}
