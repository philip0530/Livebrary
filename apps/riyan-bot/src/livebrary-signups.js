import { randomUUID } from 'node:crypto';
import { pool } from './database.js';
import { escapeLine } from './security.js';

// 사이트별 마지막으로 처리한 위치를 riyan_audit(*_CURSOR)에 남겨 재시작해도 중복·누락이 없습니다.
const reported = new Map();

function siteUrls() {
  return (process.env.LIVEBRARY_SYNC_URLS || '').split(',').map(x => x.trim().replace(/\/+$/, '')).filter(Boolean);
}

async function loadCursor(site, cursorEvent) {
  const { rows } = await pool.query(`SELECT details FROM riyan_audit WHERE event_type=$1
    AND details->>'site'=$2 ORDER BY created_at DESC LIMIT 1`, [cursorEvent, site]);
  return rows[0]?.details || null;
}

function kstTime(iso) {
  return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
}

// 피드를 읽어 Discord 메시지와 커서를 한 트랜잭션으로 저장합니다.
async function pollFeed(site, key, { path, cursorEvent, build }) {
  const cursor = await loadCursor(site, cursorEvent);
  const query = cursor ? `?${new URLSearchParams({ after: cursor.after, afterId: cursor.afterId || '' })}` : '';
  const res = await fetch(`${site}/api/integrations/riyan/${path}${query}`, {
    headers: { 'x-livebrary-sync-key': key },
    signal: AbortSignal.timeout(90_000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data?.cursor?.after) throw new Error('잘못된 응답');
  if (cursor && cursor.after === data.cursor.after && cursor.afterId === data.cursor.afterId) return [];

  const { messages, audits } = build(data);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [channelId, content] of messages) {
      await client.query('INSERT INTO riyan_delivery_queue(id,channel_id,content) VALUES ($1,$2,$3)', [randomUUID(), channelId, content]);
    }
    for (const [eventType, actorId, details] of audits) {
      await client.query('INSERT INTO riyan_audit(id,event_type,actor_id,details) VALUES ($1,$2,$3,$4)',
        [randomUUID(), eventType, actorId, JSON.stringify(details)]);
    }
    await client.query('INSERT INTO riyan_audit(id,event_type,details) VALUES ($1,$2,$3)',
      [randomUUID(), cursorEvent, JSON.stringify({ site, ...data.cursor })]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
  return messages;
}

async function eachSite(label, run) {
  for (const site of siteUrls()) {
    const tag = `${label}:${site}`;
    try {
      await run(site);
      reported.delete(tag);
    } catch (e) {
      // 사이트가 꺼져 있으면 1분마다 재시도하므로 같은 오류는 한 번만 출력합니다.
      const message = String(e?.message || e).slice(0, 120);
      if (reported.get(tag) === message) continue;
      reported.set(tag, message);
      console.error(`[리얀] ${label} 확인 실패 (${site}), 1분마다 재시도:`, message);
    }
  }
}

// 새 가입자를 활동 채널(DISCORD_ACTIVITY_CHANNEL_ID)에 알립니다. 1분마다 index.js에서 호출.
export async function pollSignups() {
  const key = process.env.LIVEBRARY_SYNC_KEY?.trim();
  const channelId = process.env.DISCORD_ACTIVITY_CHANNEL_ID?.trim();
  if (!key || !channelId) return;
  await eachSite('회원가입', async site => {
    let users = [];
    await pollFeed(site, key, {
      path: 'registrations',
      cursorEvent: 'LIVEBRARY_SIGNUP_CURSOR',
      build: data => {
        users = data.users || [];
        return {
          messages: users.map(user => [channelId,
            `**[회원가입]** ${escapeLine(user.username)}\nLivebrary ID: \`${escapeLine(user.id)}\`\n사이트: <${site}>\n시각: ${kstTime(user.createdAt)} KST\n총 회원: ${Number(data.total) || '-'}명`]),
          audits: users.map(user => ['LIVEBRARY_USER_REGISTERED', user.id, { site, username: user.username }])
        };
      }
    });
    for (const user of users) console.log(`[리얀] 회원가입 알림: ${user.username} (${site})`);
  });
}

// 한 메시지에 자세히 보여 줄 최대 건수 (나머지는 "외 N건")
const SECURITY_LINES = 10;
// 한 번 확인한 묶음에서 같은 IP가 이 횟수 이상이면 "반복 시도"로 강조
const REPEAT_THRESHOLD = 5;

// 보안 이벤트 여러 건을 디스코드 메시지 하나로 묶습니다. (2000자 제한 때문에 1900자에서 자름)
function securityMessage(site, events) {
  const lines = events.slice(0, SECURITY_LINES).map(event => {
    const who = event.username ? `@${escapeLine(event.username)}` : event.email ? escapeLine(event.email) : '익명';
    const detail = event.detail ? ` · ${escapeLine(event.detail)}` : '';
    return `- \`${kstTime(event.createdAt)}\` **${escapeLine(event.eventType)}** ${who} \`${escapeLine(event.ip || '-')}\`${detail}`;
  });
  if (events.length > SECURITY_LINES) lines.push(`- 외 ${events.length - SECURITY_LINES}건`);
  const counts = new Map();
  for (const event of events) if (event.ip) counts.set(event.ip, (counts.get(event.ip) || 0) + 1);
  const repeated = [...counts].filter(([, n]) => n >= REPEAT_THRESHOLD).map(([ip, n]) => `\`${escapeLine(ip)}\` ${n}회`);
  const warning = repeated.length ? `\n⚠ 반복 시도: ${repeated.join(', ')}` : '';
  return `**[보안 경고]** ${events.length}건 · <${site}>\n${lines.join('\n')}${warning}`.slice(0, 1900);
}

// 사이트의 이상 행동(로그인 실패, 권한 없는 접근 등)을 보안 채널(DISCORD_SECURITY_CHANNEL_ID)에 올립니다.
export async function pollSecurity() {
  const key = process.env.LIVEBRARY_SYNC_KEY?.trim();
  const channelId = process.env.DISCORD_SECURITY_CHANNEL_ID?.trim();
  if (!key || !channelId) return;
  await eachSite('보안 로그', async site => {
    const sent = await pollFeed(site, key, {
      path: 'security-events',
      cursorEvent: 'LIVEBRARY_SECURITY_CURSOR',
      build: data => {
        const events = data.events || [];
        return {
          messages: events.length ? [[channelId, securityMessage(site, events)]] : [],
          audits: events.length ? [['LIVEBRARY_SECURITY_REPORTED', null, { site, count: events.length }]] : []
        };
      }
    });
    if (sent.length) console.log(`[리얀] 보안 경고 전송 (${site})`);
  });
}

// 디스코드 사용자별 가입 인증 시도 제한: 10분에 5회 (코드 무작위 대입 방지)
async function attemptAllowed(discordUserId) {
  const windowKey = `signup:${Math.floor(Date.now() / (10 * 60_000))}`;
  const { rows } = await pool.query(`INSERT INTO riyan_attempts(discord_user_id,window_key,attempts)
    VALUES($1,$2,1) ON CONFLICT(discord_user_id,window_key)
    DO UPDATE SET attempts=riyan_attempts.attempts+1 RETURNING attempts`, [discordUserId, windowKey]);
  return rows[0].attempts <= 5;
}

// 사이트에서 가입 대기 중인 코드를 Discord 계정으로 승인합니다. 어느 사이트에도 없으면 { found: false }.
// LIVEBRARY_SYNC_URLS의 사이트(Render, 로컬)를 차례로 확인하며, 꺼져 있는 사이트는 건너뜁니다.
export async function verifySignupCode(code, discordUserId, discordName) {
  const key = process.env.LIVEBRARY_SYNC_KEY?.trim();
  const clean = String(code).replace(/[\s-]/g, '').toUpperCase();
  if (!key || !/^[A-Z2-9]{10}$/.test(clean)) return { found: false };
  if (!(await attemptAllowed(discordUserId))) return { found: true, ok: false, message: '시도 횟수가 초과되었습니다. 잠시 후 다시 시도하세요.' };
  let unreachable = false;
  for (const site of siteUrls()) {
    try {
      const res = await fetch(`${site}/api/integrations/riyan/registration-verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-livebrary-sync-key': key },
        body: JSON.stringify({ code: clean, discordUserId, discordName }),
        signal: AbortSignal.timeout(30_000)
      });
      if (res.status === 404) continue;
      const data = await res.json().catch(() => ({}));
      if (res.ok) return { found: true, ok: true, site, username: data.username };
      return { found: true, ok: false, message: data?.error?.message || `사이트 오류 (HTTP ${res.status})` };
    } catch {
      unreachable = true;
    }
  }
  if (unreachable) return { found: false, unreachable: true };
  return { found: false };
}
