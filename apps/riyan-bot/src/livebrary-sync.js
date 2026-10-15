import { pool, audit } from './database.js';
import { decrypt } from './security.js';
import { getKstWeek } from './time.js';

// 사이트 주소별로 마지막으로 전달한 (주차, 코드 해시)를 기억해 같은 코드를 반복 전송하지 않습니다.
const delivered = new Map();
const reported = new Map();

function siteUrls() {
  return (process.env.LIVEBRARY_SYNC_URLS || '').split(',').map(x => x.trim().replace(/\/+$/, '')).filter(Boolean);
}

export async function syncWeeklyCodeToSites() {
  const urls = siteUrls();
  const key = process.env.LIVEBRARY_SYNC_KEY?.trim();
  if (!urls.length || !key) return;
  const { weekStart } = getKstWeek();
  const { rows } = await pool.query(
    'SELECT encrypted_code, code_hash FROM riyan_admin_codes WHERE week_start=$1 AND expires_at > now()', [weekStart]);
  if (!rows[0]) return;
  const marker = `${weekStart}:${rows[0].code_hash}`;
  for (const url of urls) {
    if (delivered.get(url) === marker) continue;
    try {
      const res = await fetch(`${url}/api/integrations/riyan/admin-code`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-livebrary-sync-key': key },
        body: JSON.stringify({ weekStart, code: decrypt(rows[0].encrypted_code) }),
        signal: AbortSignal.timeout(90_000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      delivered.set(url, marker);
      await audit('ADMIN_CODE_SITE_SYNCED', null, null, { weekStart, site: url });
      console.log(`[리얀] 주간 코드 사이트 전달: ${url}`);
    } catch (e) {
      // 사이트가 꺼져 있으면 1분마다 재시도하므로, 같은 코드에 대한 실패는 한 번만 출력합니다.
      if (reported.get(url) === marker) continue;
      reported.set(url, marker);
      console.error(`[리얀] 주간 코드 사이트 전달 실패 (${url}), 1분마다 재시도:`, String(e?.message || e).slice(0, 120));
    }
  }
}
