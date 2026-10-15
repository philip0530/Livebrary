import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Cron } from 'croner';
import { discordClient, registerHandlers, sendText } from './discord.js';
import { ensureWeeklyCode } from './weekly.js';
import { pool, drainQueue } from './database.js';
import { startInternalApi } from './api.js';
import { requireEnv } from './security.js';
import { syncWeeklyCodeToSites } from './livebrary-sync.js';
import { pollSecurity, pollSignups } from './livebrary-signups.js';

async function main() {
  for (const name of [
    'DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID',
    'DISCORD_NOTICE_CHANNEL_ID', 'DISCORD_DEVELOPER_CODE_CHANNEL_ID',
    'INTERNAL_API_KEY', 'CODE_HASH_PEPPER', 'ADMIN_CODE_ENCRYPTION_KEY', 'DATABASE_URL'
  ]) requireEnv(name);
  if (!process.env.LIVEBRARY_ADMIN_USER_IDS?.trim()) {
    throw new Error('LIVEBRARY_ADMIN_USER_IDS에 실제 서비스 관리자 ID를 등록하세요.');
  }
  // 표가 없으면 만듭니다 (모두 IF NOT EXISTS). Livebrary DB를 같이 써도 riyan_ 접두사로 겹치지 않습니다.
  await pool.query(readFileSync(new URL('../sql/schema.sql', import.meta.url), 'utf8'));
  registerHandlers();
  discordClient.once('ready', async () => {
    console.log(`[리얀] 로그인 성공: ${discordClient.user.tag}`);
    try { await ensureWeeklyCode(discordClient); }
    catch (e) { console.error('[리얀] 주간 코드 게시 실패:', e.message); }
    // 매주 월요일 00:00 KST. 서버 재시작 후 누락 게시도 복구합니다.
    new Cron('0 0 * * MON', { timezone: 'Asia/Seoul' }, async () => {
      try { await ensureWeeklyCode(discordClient); }
      catch (e) { console.error('[리얀] 주간 코드 교체 실패:', e.message); }
    });
    await syncWeeklyCodeToSites().catch(e => console.error('[리얀] 사이트 전달 오류:', e.message));
    if (!process.env.DISCORD_ACTIVITY_CHANNEL_ID?.trim()) console.warn('[리얀] DISCORD_ACTIVITY_CHANNEL_ID가 없어 회원가입 알림을 보내지 않습니다.');
    if (!process.env.DISCORD_SECURITY_CHANNEL_ID?.trim()) console.warn('[리얀] DISCORD_SECURITY_CHANNEL_ID가 없어 보안 경고를 보내지 않습니다.');
    await pollSignups().catch(e => console.error('[리얀] 회원가입 확인 오류:', e.message));
    await pollSecurity().catch(e => console.error('[리얀] 보안 로그 확인 오류:', e.message));
    setInterval(async () => {
      try { await ensureWeeklyCode(discordClient); } // 실패한 비공개 게시 재시도 및 주차 보정
      catch (e) { console.error('[리얀] 코드 게시 재시도 실패:', e.message); }
      await syncWeeklyCodeToSites().catch(e => console.error('[리얀] 사이트 전달 오류:', e.message));
      await pollSignups().catch(e => console.error('[리얀] 회원가입 확인 오류:', e.message));
      await pollSecurity().catch(e => console.error('[리얀] 보안 로그 확인 오류:', e.message));
    }, 60_000);
    setInterval(async () => {
      try { await drainQueue(sendText); }
      catch (e) { console.error('[리얀] 감사 로그 큐 오류:', e.message); }
    }, 5_000);
    startInternalApi();
  });
  await discordClient.login(requireEnv('DISCORD_BOT_TOKEN'));
}
main().catch(err => {
  console.error('[리얀] 시작 실패:', String(err?.message || err));
  process.exitCode = 1;
});
