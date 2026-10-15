const KST_MS = 9 * 60 * 60 * 1000;
// 한국 표준시(UTC+9)의 매주 월요일 00:00을 UTC Date로 환산합니다.
export function getKstWeek(date = new Date()) {
  const shifted = new Date(date.getTime() + KST_MS);
  const mondayDistance = (shifted.getUTCDay() + 6) % 7;
  shifted.setUTCDate(shifted.getUTCDate() - mondayDistance);
  const weekStart = shifted.toISOString().slice(0, 10);
  const validFrom = new Date(`${weekStart}T00:00:00+09:00`);
  return { weekStart, validFrom, expiresAt: new Date(validFrom.getTime() + 7 * 86400000) };
}
