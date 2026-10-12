const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000

export type SeoulParts = {
  year: number
  month: number
  day: number
  weekday: number
  hour: number
  minute: number
  second: number
}

export function seoulParts(date: Date): SeoulParts {
  const shifted = new Date(date.getTime() + SEOUL_OFFSET_MS)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  }
}

/** Monday 00:00 Asia/Seoul for the week that contains `date`. */
export function weekStart(date = new Date()): Date {
  const parts = seoulParts(date)
  const daysSinceMonday = (parts.weekday + 6) % 7
  const midnightKst = Date.UTC(parts.year, parts.month, parts.day) - SEOUL_OFFSET_MS
  return new Date(midnightKst - daysSinceMonday * 24 * 60 * 60 * 1000)
}

export function nextWeekStart(date = new Date()): Date {
  return new Date(weekStart(date).getTime() + 7 * 24 * 60 * 60 * 1000)
}

export function formatKst(date: Date): string {
  const parts = seoulParts(date)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${parts.year}-${pad(parts.month + 1)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)} KST`
}
