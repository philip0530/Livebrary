import {
  Client, GatewayIntentBits, Events, MessageFlags, PermissionFlagsBits,
  SlashCommandBuilder, ChannelType
} from 'discord.js';
import { audit, queueMessage } from './database.js';
import { escapeLine, requireEnv } from './security.js';
import { claimVerificationCode } from './verification.js';
import { verifySignupCode } from './livebrary-signups.js';
import { ensureWeeklyCode, currentCodeStatus } from './weekly.js';

export const discordClient = new Client({ intents: [GatewayIntentBits.Guilds] });

const operators = new Set((process.env.DISCORD_OPERATOR_IDS || '').split(',').map(x => x.trim()).filter(Boolean));
function isOperator(interaction) {
  return operators.has(interaction.user.id) ||
    Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
}

export const commands = [
  new SlashCommandBuilder().setName('공지').setDescription('마크다운 공지 발송 (운영자 전용)')
    .addStringOption(o => o.setName('제목').setDescription('공지 제목').setRequired(true).setMaxLength(90))
    .addStringOption(o => o.setName('내용').setDescription('Discord 마크다운 내용').setRequired(true).setMaxLength(1500))
    .addChannelOption(o => o.setName('채널').setDescription('전송할 텍스트 채널 (기본 공지 채널)').addChannelTypes(ChannelType.GuildText)),
  new SlashCommandBuilder().setName('코드공유').setDescription('마크다운 코드 블록을 채널에 공유')
    .addStringOption(o => o.setName('언어').setDescription('예: js, ts, py, cs').setRequired(true).setMaxLength(16))
    .addStringOption(o => o.setName('코드').setDescription('공유할 코드 (최대 1500자)').setRequired(true).setMaxLength(1500)),
  new SlashCommandBuilder().setName('인증').setDescription('Livebrary 계정을 Discord와 연결')
    .addStringOption(o => o.setName('코드').setDescription('Livebrary 사이트에서 발급받은 일회용 코드').setRequired(true).setMinLength(8).setMaxLength(20)),
  new SlashCommandBuilder().setName('코드').setDescription('주간 관리자 키워드 게시 상태 (운영자 전용)')
    .addStringOption(o => o.setName('작업').setDescription('상태 확인 / 재게시 / 재발급').setRequired(true)
      .addChoices({ name: '상태', value: 'status' }, { name: '재게시', value: 'repost' }, { name: '재발급', value: 'rotate' })),
  new SlashCommandBuilder().setName('상태').setDescription('리얀 봇 연결 상태 확인')
].map(x => x.toJSON());

export async function sendText(channelId, content) {
  const channel = await discordClient.channels.fetch(channelId);
  if (!channel || channel.guildId !== process.env.DISCORD_GUILD_ID || typeof channel.send !== 'function') {
    throw new Error('유효하지 않은 Discord 채널');
  }
  // 본문 자체는 Markdown을 허용하지만 @everyone 등 멘션 통지는 모두 차단
  return channel.send({ content, allowedMentions: { parse: [] } });
}

async function handleCommand(interaction) {
  if (!interaction.guildId || interaction.guildId !== process.env.DISCORD_GUILD_ID) {
    return interaction.reply({ content: '이 서버에서만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
  }
  const name = interaction.commandName;
  if (name === '상태') {
    return interaction.reply({
      content: '**리얀 · Livebrary Bot**\n- 상태: **ONLINE**\n- 공지: Markdown 지원\n- 관리자 코드: 매주 월요일 00:00 KST\n- 계정 인증: Livebrary 사이트에서 코드 발급',
      flags: MessageFlags.Ephemeral
    });
  }
  if (name === '코드공유') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (process.env.DISCORD_VERIFIED_ROLE_ID) {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!member.roles.cache.has(process.env.DISCORD_VERIFIED_ROLE_ID)) {
        return interaction.editReply('Livebrary 인증 역할을 받은 사용자만 코드를 공유할 수 있습니다.');
      }
    }
    const language = interaction.options.getString('언어', true).toLowerCase();
    if (!/^[a-z0-9+#.\-]{1,16}$/.test(language)) return interaction.editReply('언어 이름에 허용되지 않은 문자가 있습니다.');
    const code = interaction.options.getString('코드', true).replace(/```/g, '`\u200b``');
    const message = `**[코드 공유]** <@${interaction.user.id}>\n\n\`\`\`${language}\n${code}\n\`\`\``;
    if (message.length > 2000) return interaction.editReply('코드가 너무 깁니다.');
    await sendText(interaction.channelId, message);
    await audit('DISCORD_CODE_SNIPPET_POSTED', null, interaction.user.id, { language, channelId: interaction.channelId });
    return interaction.editReply('코드를 마크다운 블록으로 공유했습니다.');
  }
  if (name === '인증') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const code = interaction.options.getString('코드', true);
    // 1) 신규 가입 코드인지 먼저 확인합니다. 이 명령은 이 서버 안에서만 동작하므로 서버 멤버만 가입할 수 있습니다.
    const signup = await verifySignupCode(code, interaction.user.id, interaction.user.tag);
    if (signup.found) {
      if (!signup.ok) return interaction.editReply(`**가입 인증 실패**\n${escapeLine(signup.message)}`);
      await audit('LIVEBRARY_SIGNUP_VERIFIED', null, interaction.user.id, { site: signup.site, username: signup.username });
      if (process.env.DISCORD_VERIFIED_ROLE_ID) {
        try {
          const member = await interaction.guild.members.fetch(interaction.user.id);
          await member.roles.add(process.env.DISCORD_VERIFIED_ROLE_ID, 'Livebrary signup verified by Riyan');
        } catch {
          await audit('DISCORD_VERIFY_ROLE_FAILED', null, interaction.user.id, { signup: true });
        }
      }
      return interaction.editReply(`**가입 인증 완료** · ${escapeLine(signup.username || '')}\n사이트로 돌아가면 자동으로 가입이 완료됩니다.`);
    }
    // 2) 가입 코드가 아니면 기존 계정의 디스코드 연결 코드로 처리합니다.
    const result = await claimVerificationCode(code, interaction.user.id);
    if (!result.ok) {
      const note = signup.unreachable ? '\n(일부 Livebrary 사이트에 연결하지 못했습니다. 잠시 후 다시 시도하세요.)' : '';
      return interaction.editReply(`**인증 실패**\n${result.message}${note}\n사이트: ${process.env.LIVEBRARY_CONNECT_URL}`);
    }
    const role = process.env.DISCORD_VERIFIED_ROLE_ID;
    let roleMessage = 'Livebrary 계정 연결이 완료되었습니다.';
    if (role) {
      try {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        await member.roles.add(role, 'Livebrary account verified by Riyan');
        roleMessage += ' 인증 역할이 부여되었습니다.';
      } catch {
        roleMessage += ' 단, Discord 역할 부여에는 실패하여 운영자 확인이 필요합니다.';
        await audit('DISCORD_VERIFY_ROLE_FAILED', result.userId, interaction.user.id);
        if (process.env.DISCORD_SECURITY_CHANNEL_ID) {
          await queueMessage(process.env.DISCORD_SECURITY_CHANNEL_ID,
            `**[인증 역할 부여 실패]**\nLivebrary ID: \`${escapeLine(result.userId)}\`\nDiscord ID: \`${interaction.user.id}\``);
        }
      }
    }
    if (process.env.DISCORD_ACTIVITY_CHANNEL_ID) {
      await queueMessage(process.env.DISCORD_ACTIVITY_CHANNEL_ID,
        `**[계정 인증 완료]**\nLivebrary ID: \`${escapeLine(result.userId)}\`\nDiscord ID: \`${interaction.user.id}\``);
    }
    return interaction.editReply(`**인증 성공**\n${roleMessage}`);
  }
  if (name === '공지' || name === '코드') {
    const allowed = name === '코드' ? operators.has(interaction.user.id) : isOperator(interaction);
    if (!allowed) {
      await audit('DISCORD_OPERATOR_ACCESS_DENIED', null, interaction.user.id, { command: name });
      return interaction.reply({ content: '이 명령어는 허가된 운영자만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
    }
  }
  if (name === '공지') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const title = escapeLine(interaction.options.getString('제목', true));
    const body = interaction.options.getString('내용', true);
    const targetId = interaction.options.getChannel('채널')?.id || requireEnv('DISCORD_NOTICE_CHANNEL_ID');
    const message = `# 📢 ${title}\n\n${body}\n\n-# Livebrary | 리얀`;
    if (message.length > 2000) return interaction.editReply('공지 내용이 Discord 메시지 길이 제한을 초과했습니다.');
    await sendText(targetId, message);
    await audit('DISCORD_NOTICE_POSTED', null, interaction.user.id, { targetId, title });
    return interaction.editReply(`공지 전송 완료: <#${targetId}>`);
  }
  if (name === '코드') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const action = interaction.options.getString('작업', true);
    if (action === 'status') {
      const status = await currentCodeStatus();
      return interaction.editReply(`**주간 관리자 키워드 현황**\n- 주차: ${status.week_start}\n- Discord 게시: ${status.posted_at ? '완료' : '미완료'}\n- 키워드 원문: 이 채널에 표시하지 않습니다.`);
    }
    if (action === 'repost') {
      // 현재 키워드를 다시 게시하도록 상태만 초기화
      const { getKstWeek } = await import('./weekly.js');
      const { pool } = await import('./database.js');
      const { weekStart } = getKstWeek();
      await pool.query('UPDATE riyan_admin_codes SET posted_at=NULL WHERE week_start=$1', [weekStart]);
      await ensureWeeklyCode(discordClient);
      await audit('DISCORD_CODE_REPOST_REQUESTED', null, interaction.user.id);
      return interaction.editReply('현재 주간 키워드를 비공개 개발자 코드 채널에 다시 게시했습니다.');
    }
    if (action === 'rotate') {
      await ensureWeeklyCode(discordClient, true);
      await audit('DISCORD_CODE_ROTATION_REQUESTED', null, interaction.user.id);
      return interaction.editReply('새 주간 키워드가 발급되고 비공개 채널에 게시되었습니다. 이전 키워드는 무효화되었습니다.');
    }
  }
}

export function registerHandlers() {
  discordClient.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    try { await handleCommand(interaction); }
    catch (error) {
      console.error(`[리얀] 명령 실행 실패: ${String(error?.message || error).slice(0, 200)}`);
      const message = '요청 처리 중 오류가 발생했습니다. 봇 설정 또는 서버 연결을 확인하세요.';
      if (interaction.deferred || interaction.replied) await interaction.editReply(message).catch(() => {});
      else await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  });
}
