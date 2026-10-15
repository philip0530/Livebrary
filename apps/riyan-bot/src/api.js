import http from 'node:http';
import { pool, audit, queueMessage } from './database.js';
import { requireEnv, secretEqual, escapeLine } from './security.js';
import { issueVerificationCode } from './verification.js';
import { verifyAdminKeyword } from './weekly.js';

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16_384) throw new Error('본문이 너무 큽니다.');
  }
  return JSON.parse(raw || '{}');
}
function respond(res, status, data) {
  const payload = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff' });
  res.end(payload);
}
const allowedEvents = new Set([
  'SITE_GATE_ENTERED', 'ACCOUNT_REGISTERED', 'ACCOUNT_LOGIN', 'ACCOUNT_LOGOUT',
  'PROJECT_CREATED', 'PROJECT_JOINED', 'PROJECT_UPDATED', 'PROJECT_DELETED',
  'FILE_CREATED', 'FILE_UPDATED', 'FILE_DELETED', 'FILE_RENAMED', 'FILE_RESTORED',
  'PROJECT_INVITED', 'PROJECT_ROLE_CHANGED', 'SECURITY_DENIED', 'ADMIN_LOGIN_SUCCESS',
  'ADMIN_LOGIN_FAILED'
]);
export function startInternalApi() {
  const server = http.createServer(async (req, res) => {
    try {
      const key = req.headers['x-livebrary-internal-key'];
      if (typeof key !== 'string' || !secretEqual(key, requireEnv('INTERNAL_API_KEY'))) {
        return respond(res, 401, { error: 'unauthorized' });
      }
      const url = new URL(req.url || '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/internal/health') return respond(res, 200, { ok: true, bot: '리얀' });
      if (req.method === 'GET' && url.pathname === '/internal/link-status') {
        const userId = url.searchParams.get('livebraryUserId') || '';
        const { rows } = await pool.query('SELECT discord_user_id,verified_at FROM riyan_links WHERE livebrary_user_id=$1', [userId]);
        return respond(res, 200, { linked: !!rows[0], discordUserId: rows[0]?.discord_user_id || null });
      }
      if (req.method !== 'POST') return respond(res, 404, { error: 'not_found' });
      const body = await readJson(req);
      if (url.pathname === '/internal/verification-codes') {
        const result = await issueVerificationCode(body.livebraryUserId);
        return respond(res, 200, result);
      }
      if (url.pathname === '/internal/admin/verify-keyword') {
        // 사이트 백엔드는 이 요청 전에 로그인+SYSTEM_ADMIN 권한을 확인하고,
        // 성공 뒤 반드시 MFA를 거쳐야 합니다. 이 API는 관리자 세션을 발급하지 않습니다.
        const permitted = await verifyAdminKeyword(body.livebraryUserId, body.keyword);
        await audit('ADMIN_KEYWORD_CHECK', body.livebraryUserId || null, null, { permitted });
        return respond(res, 200, { valid: permitted, mfaRequired: true });
      }
      if (url.pathname === '/internal/audit') {
        if (!allowedEvents.has(body.eventType) || typeof body.eventId !== 'string' || body.eventId.length > 80) {
          return respond(res, 400, { error: 'invalid_event' });
        }
        const id = String(body.actorId || '').slice(0, 128);
        const project = String(body.projectId || '').slice(0, 128);
        const event = String(body.eventType);
        await audit(event, id || null, project || null, { eventId: body.eventId });
        const security = event.startsWith('SECURITY_') || event.startsWith('ADMIN_');
        const channel = security ? process.env.DISCORD_SECURITY_CHANNEL_ID : process.env.DISCORD_ACTIVITY_CHANNEL_ID;
        if (channel) await queueMessage(channel,
          `**[${escapeLine(event)}]**\n사용자: \`${escapeLine(id || 'anonymous')}\`\n프로젝트: \`${escapeLine(project || '-')}\`\n이벤트 ID: \`${escapeLine(body.eventId)}\``);
        return respond(res, 202, { queued: true });
      }
      return respond(res, 404, { error: 'not_found' });
    } catch (error) {
      console.error('[리얀] 내부 API 오류:', String(error?.message || error).slice(0, 180));
      return respond(res, 400, { error: 'request_failed' });
    }
  });
  const host = process.env.INTERNAL_HOST || '127.0.0.1';
  const port = Number(process.env.INTERNAL_PORT || 3841);
  server.listen(port, host, () => console.log(`[리얀] 내부 API: http://${host}:${port}`));
  return server;
}
