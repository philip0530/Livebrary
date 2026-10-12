const TARGET = 'join'

export type JoinPushResult = {
  matched: boolean
  progress: string
}

export type JoinBuffer = {
  push: (key: string, now?: number) => JoinPushResult
  reset: () => void
  value: () => string
}

export function createJoinBuffer(resetMs = 3000): JoinBuffer {
  let value = ''
  let last = 0

  return {
    value: () => value,
    reset() {
      value = ''
      last = 0
    },
    push(key: string, now = Date.now()) {
      if (last !== 0 && now - last >= resetMs) value = ''
      last = now
      if (key === 'Backspace' || key === 'backspace') {
        value = value.slice(0, -1)
        return { matched: false, progress: value }
      }
      if (key.length !== 1 || !/^[a-z]$/i.test(key)) {
        return { matched: false, progress: value }
      }
      const ch = key.toLowerCase()
      const next = value + ch
      if (TARGET.startsWith(next)) {
        value = next
        return { matched: value === TARGET, progress: value }
      }
      value = TARGET.startsWith(ch) ? ch : ''
      return { matched: false, progress: value }
    },
  }
}
