import crypto from 'node:crypto';

export function requireEnv(name) {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`필수 환경변수 누락: ${name}`);
  return value.trim();
}
export function secretEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
export function digest(text) {
  return crypto.createHmac('sha256', requireEnv('CODE_HASH_PEPPER')).update(text.toLowerCase()).digest('hex');
}
function encryptionKey() {
  const raw = Buffer.from(requireEnv('ADMIN_CODE_ENCRYPTION_KEY'), 'hex');
  if (raw.length !== 32) throw new Error('ADMIN_CODE_ENCRYPTION_KEY는 32바이트 hex여야 합니다.');
  return raw;
}
export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const content = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), content]).toString('base64');
}
export function decrypt(b64) {
  const data = Buffer.from(b64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}
// 모호한 문자를 배제한 10자리 일회용 코드: 32^10 = 50비트
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomVerifyCode() {
  return Array.from({length: 10}, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
}
const ROOTS = [
  'memento','mori','oblivion','silentium','nocturne','palimpsest','afterglow',
  'redshift','lacrimosa','aether','arcane','atlas','aurora','cobalt','cipher',
  'elysium','zenith','orbit','nebula','phantom','solstice','eclipse','vortex',
  'lumen','verdant','astral','spectrum','echo','raven','winter','paradox',
  'chronos','seraph','abyss','velvet','mirage','quartz','ember','nexus','umbra',
  'requiem','lullaby','fragment','arcadia','memoria','veritas','anima','lucent',
  'sanctum','cascade','horizon','stellar','radian','ether','sable','rhapsody',
  'cadenza','viridian','obscura','halcyon','mirabilis','tempus','finis','carpe',
  'diem','nostalgia','fugue','meridian','sylvan','vesper','infinity','redemption',
  'serenity','chimera','lazarus','helios','enigma','mystic','lithium','nova',
  'oxford','argentum','lumina','citadel','silhouette','aeon','monolith','cairn',
  'eleven','fable','obsidian','mosaic','harmony','aurelia','noctis','cipherium'
];
export function randomAdminWord(exclude = new Set()) {
  for (let i = 0; i < 1000; i++) {
    const count = crypto.randomInt(2, 4);
    let value = '';
    for (let j = 0; j < count; j++) value += ROOTS[crypto.randomInt(ROOTS.length)];
    if (value.length >= 8 && value.length <= 24 && !exclude.has(value)) return value;
  }
  throw new Error('새 관리자 단어를 생성하지 못했습니다.');
}
export function escapeLine(value) {
  // 외부 로그/제목은 Markdown 이스케이프; 본문 공지는 의도적으로 Markdown 허용
  return String(value).replace(/\\/g, '\\\\').replace(/([*_~`>|#])/g, '\\$1').replace(/@/g, '@\u200b').replace(/[\r\n]/g, ' ');
}
export function adminIds() {
  return new Set((process.env.LIVEBRARY_ADMIN_USER_IDS || '').split(',').map(x => x.trim()).filter(Boolean));
}
