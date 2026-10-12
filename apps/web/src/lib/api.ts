export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
  }
}

function csrfToken(): string {
  const entry = document.cookie.split('; ').find((part) => part.startsWith('lb_csrf='))
  return entry ? decodeURIComponent(entry.slice('lb_csrf='.length)) : ''
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const method = (init.method ?? 'GET').toUpperCase()
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  if (method !== 'GET' && method !== 'HEAD') {
    const token = csrfToken()
    if (token) headers.set('x-csrf-token', token)
  }
  const response = await fetch(path, { ...init, headers, credentials: 'include' })
  const text = await response.text()
  const data = text ? JSON.parse(text) as { error?: { code?: string; message?: string } } : {}
  if (!response.ok) {
    throw new ApiError(response.status, data.error?.code ?? 'REQUEST_FAILED', data.error?.message ?? '요청에 실패했습니다.')
  }
  return data as T
}

export async function downloadFile(path: string, filename: string): Promise<void> {
  const response = await fetch(path, { credentials: 'include' })
  if (!response.ok) throw new ApiError(response.status, 'DOWNLOAD', '다운로드에 실패했습니다.')
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function clearLocalUserData(): Promise<void> {
  if (!indexedDB.databases) return
  const databases = await indexedDB.databases()
  await Promise.all(databases.filter((db) => db.name?.startsWith('project:')).map((db) => indexedDB.deleteDatabase(db.name!)))
}
