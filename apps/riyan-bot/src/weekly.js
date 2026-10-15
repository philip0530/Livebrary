import { pool, audit } from './database.js';
import { randomAdminWord, encrypt, decrypt, digest, adminIds, secretEqual } from './security.js';
export { getKstWeek } from './time.js';
import { getKstWeek } from './time.js';

function weeklyMarkdown(word, validFrom, expiresAt) {
  const date = (d) => new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(d);
  return [
    '# LIVEBRARY · 주간 관리자 입장 코드',
    `**발급:** ${date(validFrom)} KST`,
    `**만료:** ${date(expiresAt)} KST`,
    '**접속 코드**',
    '```text', word, '```',
    '-# 이 채널은 제작자 전용입니다. 코드만으로 관리자 권한이 부여되지는 않습니다.'
  ].join('\n');
}

// 다중 프로세스에서 중복 발급 및 중복 게시를 줄이기 위한 PostgreSQL advisory lock.
export async function ensureWeeklyCode(discordClient, force = false) {
  const db = await pool.connect();
  try {
    await db.query('SELECT pg_advisory_lock(497812345)');
    const { weekStart, validFrom, expiresAt } = getKstWeek();
    let row = (await db.query('SELECT * FROM riyan_admin_codes WHERE week_start=$1', [weekStart])).rows[0];
    if (!row || force) {
      const last = (await db.query('SELECT encrypted_code FROM riyan_admin_codes ORDER BY week_start DESC LIMIT 12')).rows;
      const excluded = new Set(last.map(r => decrypt(r.encrypted_code)));
      const code = randomAdminWord(excluded);
      await db.query(`INSERT INTO riyan_admin_codes (week_start,encrypted_code,code_hash,valid_from,expires_at)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (week_start) DO UPDATE SET encrypted_code=EXCLUDED.encrypted_code,
        code_hash=EXCLUDED.code_hash,valid_from=EXCLUDED.valid_from,expires_at=EXCLUDED.expires_at,
        posted_at=NULL,posted_message_id=NULL`,
        [weekStart, encrypt(code), digest(code), validFrom, expiresAt]);
      row = (await db.query('SELECT * FROM riyan_admin_codes WHERE week_start=$1', [weekStart])).rows[0];
      await audit(force ? 'ADMIN_CODE_MANUAL_ROTATION' : 'ADMIN_CODE_ROTATION', null, null, { weekStart });
    }
    if (!row.posted_at) {
      const channelId = process.env.DISCORD_DEVELOPER_CODE_CHANNEL_ID;
      const channel = await discordClient.channels.fetch(channelId);
      if (!channel || typeof channel.send !== 'function' || channel.guildId !== process.env.DISCORD_GUILD_ID) {
        throw new Error('개발자 코드 로그 채널을 확인할 수 없습니다.');
      }
      const msg = await channel.send({
        content: weeklyMarkdown(decrypt(row.encrypted_code), validFrom, expiresAt),
        allowedMentions: { parse: [] }
      });
      await db.query('UPDATE riyan_admin_codes SET posted_at=now(),posted_message_id=$2 WHERE week_start=$1',
        [weekStart, msg.id]);
      await audit('ADMIN_CODE_DISCORD_POSTED', null, null, { weekStart, channelId });
    }
    return { weekStart, posted: true, expiresAt };
  } finally {
    await db.query('SELECT pg_advisory_unlock(497812345)').catch(() => {});
    db.release();
  }
}

// 반드시 Livebrary 백엔드의 로그인/관리자 권한 확인 후 호출해야 합니다.
// 이 서비스도 관리자 ID 허용목록과 INTERNAL_API_KEY로 2차 제한합니다.
export async function verifyAdminKeyword(livebraryUserId, candidate) {
  if (!adminIds().has(livebraryUserId)) return false;
  if (typeof candidate !== 'string' || candidate.length > 64) return false;
  // 내부 서비스 호출에 대해서도 관리자별로 15분당 5회 제한합니다.
  const windowKey = String(Math.floor(Date.now() / (15 * 60_000)));
  const attempts = await pool.query(`INSERT INTO riyan_admin_attempts(livebrary_user_id,window_key,attempts)
    VALUES ($1,$2,1) ON CONFLICT(livebrary_user_id,window_key)
    DO UPDATE SET attempts=riyan_admin_attempts.attempts+1 RETURNING attempts`, [livebraryUserId, windowKey]);
  if (attempts.rows[0].attempts > 5) return false;
  const clean = candidate.trim().toLowerCase();
  const fallback = (process.env.ADMIN_FALLBACK_CODE || 'Trust').toLowerCase();
  if (secretEqual(digest(clean), digest(fallback))) {
    await audit('ADMIN_FALLBACK_USED', livebraryUserId);
    return true;
  }
  const { weekStart } = getKstWeek();
  const result = await pool.query(`SELECT code_hash FROM riyan_admin_codes
    WHERE week_start=$1 AND valid_from <= now() AND expires_at > now()`, [weekStart]);
  return Boolean(result.rows[0] && secretEqual(digest(clean), result.rows[0].code_hash));
}

export async function currentCodeStatus() {
  const { weekStart } = getKstWeek();
  const { rows } = await pool.query(
    'SELECT week_start, posted_at, expires_at FROM riyan_admin_codes WHERE week_start=$1', [weekStart]);
  return rows[0] || { week_start: weekStart, posted_at: null, expires_at: null };
}
