let passed = false
let resume = ''

export function hasPassedEntry(): boolean {
  return passed
}

export function passEntry(): void {
  passed = true
}

export function rememberEntryTarget(path: string): void {
  if (!path.startsWith('/') || path.startsWith('//') || path === '/' || path.startsWith('/?')) return
  if (!resume) resume = path
}

export function destinationAfterEntry(loggedIn: boolean): string {
  const target = resume
  resume = ''
  if (target.startsWith('/invite/') && !target.includes('//')) {
    return loggedIn ? target : `/auth?next=${encodeURIComponent(target)}`
  }
  if (loggedIn && (target === '/app' || target === '/console' || target.startsWith('/console?'))) return target
  return loggedIn ? '/app' : '/auth'
}
