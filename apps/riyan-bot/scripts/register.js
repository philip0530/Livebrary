import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commands } from '../src/discord.js';
import { requireEnv } from '../src/security.js';
const rest = new REST({ version: '10' }).setToken(requireEnv('DISCORD_BOT_TOKEN'));
await rest.put(Routes.applicationGuildCommands(requireEnv('DISCORD_CLIENT_ID'), requireEnv('DISCORD_GUILD_ID')),
  { body: commands });
console.log('[리얀] Discord 슬래시 명령어 5개 등록 완료: 공지, 코드공유, 코드, 인증, 상태');
