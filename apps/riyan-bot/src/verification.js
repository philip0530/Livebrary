import { randomUUID } from 'node:crypto';
import { pool, audit } from './database.js';
import { digest, randomVerifyCode } from './security.js';

export async function issueVerificationCode(livebraryUserId) {
  if (typeof livebraryUserId !== 'string' || !/^[\w-]{1,128}$/.test(livebraryUserId)) {
    throw new Error('사용자 ID 형식이 올바르지 않습니다.');
  }
  const existing = await pool.query('SELECT discord_user_id FROM riyan_links WHERE livebrary_user_id=$1', [livebraryUserId]);
  if (existing.rowCount) return { alreadyLinked: true };
  // 웹 백엔드에서 사용자별 요청 제한을 추가해야 합니다.
  const recent = await pool.query(`SELECT created_at FROM riyan_verify_codes WHERE livebrary_user_id=$1
    ORDER BY created_at DESC LIMIT 1`, [livebraryUserId]);
  if (recent.rows[0] && Date.now() - new Date(recent.rows[0].created_at).getTime() < 30000) {
    throw new Error('인증 코드는 30초 이후 다시 발급할 수 있습니다.');
  }
  const code = randomVerifyCode();
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  await pool.query('DELETE FROM riyan_verify_codes WHERE livebrary_user_id=$1 AND consumed_at IS NULL', [livebraryUserId]);
  await pool.query(`INSERT INTO riyan_verify_codes(id,livebrary_user_id,code_hash,expires_at)
    VALUES ($1,$2,$3,$4)`, [randomUUID(), livebraryUserId, digest(code), expiresAt]);
  await audit('DISCORD_VERIFICATION_ISSUED', livebraryUserId);
  return { code, expiresAt: expiresAt.toISOString() };
}

export async function claimVerificationCode(code, discordUserId) {
  const clean = String(code).replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z2-9]{10}$/.test(clean)) return { ok: false, message: '인증 코드가 올바르지 않습니다.' };
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const windowKey = String(Math.floor(Date.now() / (10 * 60_000)));
    const attempts = await db.query(`INSERT INTO riyan_attempts(discord_user_id,window_key,attempts)
      VALUES($1,$2,1) ON CONFLICT(discord_user_id,window_key)
      DO UPDATE SET attempts=riyan_attempts.attempts+1 RETURNING attempts`, [discordUserId, windowKey]);
    if (attempts.rows[0].attempts > 5) {
      await db.query('COMMIT');
      return { ok: false, message: '시도 횟수가 초과되었습니다. 잠시 후 다시 시도하세요.' };
    }
    const selected = await db.query(`SELECT * FROM riyan_verify_codes WHERE code_hash=$1 FOR UPDATE`, [digest(clean)]);
    const row = selected.rows[0];
    if (!row || row.consumed_at || new Date(row.expires_at) <= new Date()) {
      await db.query('COMMIT');
      return { ok: false, message: '만료되었거나 잘못된 인증 코드입니다.' };
    }
    const linked = await db.query(`SELECT * FROM riyan_links
      WHERE livebrary_user_id=$1 OR discord_user_id=$2 FOR UPDATE`, [row.livebrary_user_id, discordUserId]);
    if (linked.rows.some(link => link.livebrary_user_id !== row.livebrary_user_id || link.discord_user_id !== discordUserId)) {
      await db.query('COMMIT');
      return { ok: false, message: '이미 다른 계정과 연결되어 있습니다. 사이트에서 연결 해제를 요청하세요.' };
    }
    await db.query(`INSERT INTO riyan_links(livebrary_user_id,discord_user_id)
      VALUES ($1,$2) ON CONFLICT(livebrary_user_id) DO NOTHING`, [row.livebrary_user_id, discordUserId]);
    await db.query('UPDATE riyan_verify_codes SET consumed_at=now() WHERE id=$1', [row.id]);
    await db.query('COMMIT');
    await audit('DISCORD_ACCOUNT_LINKED', row.livebrary_user_id, discordUserId);
    return { ok: true, userId: row.livebrary_user_id };
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    // DB 고유키 충돌도 안전하게 오류 처리
    return { ok: false, message: '계정 연결을 처리하지 못했습니다. 다시 시도하세요.' };
  } finally { db.release(); }
}
