export type DiffLine = {
  type: 'same' | 'add' | 'del'
  text: string
}

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n/g, '\n').split('\n')
  const b = after.replace(/\r\n/g, '\n').split('\n')
  if (a.length * b.length > 250_000) {
    return [{ type: 'add', text: '변경량이 많아 줄 비교를 생략했습니다. 스냅샷 미리보기를 사용하세요.' }]
  }
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    const current = dp[i]!
    const next = dp[i + 1]!
    for (let j = m - 1; j >= 0; j -= 1) {
      current[j] = a[i] === b[j] ? next[j + 1]! + 1 : Math.max(next[j]!, current[j + 1]!)
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i]! })
      i += 1
      j += 1
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ type: 'del', text: a[i]! })
      i += 1
    } else {
      out.push({ type: 'add', text: b[j]! })
      j += 1
    }
  }
  while (i < n) {
    out.push({ type: 'del', text: a[i]! })
    i += 1
  }
  while (j < m) {
    out.push({ type: 'add', text: b[j]! })
    j += 1
  }
  return out
}
