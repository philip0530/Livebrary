import type { NextFunction, Request, Response } from 'express'
import { timingSafeEqual } from 'node:crypto'

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

export function wrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next)
  }
}

export function routeParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) throw new HttpError(400, 'VALIDATION', '경로 매개변수가 없습니다.')
  return raw
}

export function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for']
  const value = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() ?? '' : ''
  return (value || req.ip || '').slice(0, 64)
}

export function userAgent(req: Request): string {
  return (req.get('user-agent') ?? '').slice(0, 200)
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_') || 'download'
  return `attachment; filename="${ascii.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

export function readCookieHeader(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}
