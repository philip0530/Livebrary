import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { requireEnv } from './security.js';
export const pool = new pg.Pool({ connectionString: requireEnv('DATABASE_URL'), max: 5 });

export async function audit(eventType, actorId = null, targetId = null, details = {}) {
  await pool.query('INSERT INTO riyan_audit(id,event_type,actor_id,target_id,details) VALUES ($1,$2,$3,$4,$5)',
    [randomUUID(), eventType, actorId, targetId, JSON.stringify(details)]);
}
export async function queueMessage(channelId, content) {
  await pool.query('INSERT INTO riyan_delivery_queue(id,channel_id,content) VALUES ($1,$2,$3)',
    [randomUUID(), channelId, content]);
}
// 다중 서버 환경에서도 동일 행을 중복 전송하지 않도록 SKIP LOCKED 활용
export async function drainQueue(send) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT * FROM riyan_delivery_queue WHERE delivered_at IS NULL
      AND due_at <= now() ORDER BY created_at LIMIT 5 FOR UPDATE SKIP LOCKED`);
    for (const row of rows) {
      try {
        await send(row.channel_id, row.content);
        await client.query('UPDATE riyan_delivery_queue SET delivered_at=now() WHERE id=$1', [row.id]);
      } catch (err) {
        const delay = Math.min(3600, 2 ** Math.min(row.attempts + 1, 10) * 10);
        await client.query(`UPDATE riyan_delivery_queue SET attempts=attempts+1, due_at=now()+($2 * interval '1 second'),
          last_error=$3 WHERE id=$1`, [row.id, delay, String(err.message || err).slice(0, 250)]);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
}
