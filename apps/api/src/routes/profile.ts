import { Router } from 'express'
import { prisma } from '@livebrary/database'
import { recordAudit } from '@livebrary/discord-logger'
import { isLocaleId, isThemeId, validateUsername } from '@livebrary/shared'
import { HttpError, wrap } from '../http.js'

function cleanAvatar(value: unknown): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string' || value.length > 500) throw new HttpError(400, 'VALIDATION', '프로필 이미지 주소가 올바르지 않습니다.')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new HttpError(400, 'VALIDATION', '프로필 이미지 주소가 올바르지 않습니다.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new HttpError(400, 'VALIDATION', '프로필 이미지는 http 또는 https 주소만 사용할 수 있습니다.')
  }
  return url.toString()
}

export function profileRouter(): Router {
  const router = Router()

  router.get('/users/search', wrap(async (req, res) => {
    const q = String(req.query.q ?? '').trim()
    if (q.length < 1) {
      res.json({ users: [] })
      return
    }
    const users = await prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        username: { contains: q, mode: 'insensitive' },
      },
      take: 20,
      select: { id: true, username: true, avatarUrl: true, bio: true, primaryLanguage: true },
    })
    res.json({ users })
  }))

  router.get('/users/:username', wrap(async (req, res) => {
    const username = String(req.params.username ?? '')
    const user = await prisma.user.findFirst({
      where: { usernameNormalized: username.toLowerCase(), status: 'ACTIVE' },
      select: {
        id: true,
        username: true,
        avatarUrl: true,
        bio: true,
        primaryLanguage: true,
        memberships: {
          select: { role: true, project: { select: { id: true, name: true, visibility: true } } },
          take: 20,
        },
      },
    })
    if (!user) throw new HttpError(404, 'NOT_FOUND', '사용자를 찾을 수 없습니다.')
    const self = req.user?.id === user.id
    const projects = user.memberships
      .filter((item) => self || item.project.visibility === 'PUBLIC')
      .map((item) => ({ id: item.project.id, name: item.project.name, role: item.role, visibility: item.project.visibility }))
    res.json({
      user: {
        id: user.id,
        username: user.username,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        primaryLanguage: user.primaryLanguage,
        projects,
      },
    })
  }))

  router.patch('/profile', wrap(async (req, res) => {
    const user = req.user!
    const body = req.body as { username?: string; bio?: string; primaryLanguage?: string; avatarUrl?: string | null }
    const data: { username?: string; usernameNormalized?: string; bio?: string; primaryLanguage?: string; avatarUrl?: string | null } = {}
    if (body.username !== undefined) {
      const username = body.username.trim()
      const error = validateUsername(username)
      if (error) throw new HttpError(400, 'VALIDATION', error)
      const taken = await prisma.user.findFirst({
        where: { usernameNormalized: username.toLowerCase(), NOT: { id: user.id } },
      })
      if (taken) throw new HttpError(409, 'CONFLICT', '이미 사용 중인 사용자 이름입니다.')
      data.username = username
      data.usernameNormalized = username.toLowerCase()
    }
    if (body.bio !== undefined) {
      if (typeof body.bio !== 'string' || body.bio.length > 280) throw new HttpError(400, 'VALIDATION', '자기소개는 280자 이하여야 합니다.')
      data.bio = body.bio
    }
    if (body.primaryLanguage !== undefined) {
      if (typeof body.primaryLanguage !== 'string' || body.primaryLanguage.length > 40) {
        throw new HttpError(400, 'VALIDATION', '주 사용 언어는 40자 이하여야 합니다.')
      }
      data.primaryLanguage = body.primaryLanguage.trim()
    }
    if (body.avatarUrl !== undefined) data.avatarUrl = cleanAvatar(body.avatarUrl)
    const updated = await prisma.user.update({ where: { id: user.id }, data })
    await recordAudit({
      eventType: 'PROFILE_UPDATED',
      actorId: user.id,
      resourceType: 'user',
      resourceId: user.id,
      result: 'SUCCESS',
      metadata: { username: updated.username, fields: Object.keys(data) },
    })
    res.json({
      user: {
        id: updated.id,
        username: updated.username,
        avatarUrl: updated.avatarUrl,
        bio: updated.bio,
        primaryLanguage: updated.primaryLanguage,
      },
    })
  }))

  router.patch('/settings', wrap(async (req, res) => {
    const body = req.body as Record<string, unknown>
    const data: {
      theme?: string
      fontSize?: number
      lineNumbers?: boolean
      wordWrap?: boolean
      tabSize?: number
      minimap?: boolean
      crt?: boolean
      notifications?: boolean
      locale?: string
      panelLayout?: object
    } = {}
    if (body.theme !== undefined) {
      if (typeof body.theme !== 'string' || !isThemeId(body.theme)) throw new HttpError(400, 'VALIDATION', '테마를 확인할 수 없습니다.')
      data.theme = body.theme
    }
    if (body.locale !== undefined) {
      if (typeof body.locale !== 'string' || !isLocaleId(body.locale)) throw new HttpError(400, 'VALIDATION', '언어를 확인할 수 없습니다.')
      data.locale = body.locale
    }
    if (body.fontSize !== undefined) {
      const fontSize = Number(body.fontSize)
      if (!Number.isInteger(fontSize) || fontSize < 10 || fontSize > 32) throw new HttpError(400, 'VALIDATION', '글꼴 크기는 10에서 32 사이여야 합니다.')
      data.fontSize = fontSize
    }
    if (body.tabSize !== undefined) {
      const tabSize = Number(body.tabSize)
      if (![2, 4, 8].includes(tabSize)) throw new HttpError(400, 'VALIDATION', '탭 너비는 2, 4, 8만 사용할 수 있습니다.')
      data.tabSize = tabSize
    }
    for (const key of ['lineNumbers', 'wordWrap', 'minimap', 'crt', 'notifications'] as const) {
      if (body[key] !== undefined) {
        if (typeof body[key] !== 'boolean') throw new HttpError(400, 'VALIDATION', '설정 값이 올바르지 않습니다.')
        data[key] = body[key]
      }
    }
    if (body.panelLayout !== undefined) {
      if (!body.panelLayout || typeof body.panelLayout !== 'object' || Array.isArray(body.panelLayout)) {
        throw new HttpError(400, 'VALIDATION', '패널 설정이 올바르지 않습니다.')
      }
      const source = body.panelLayout as Record<string, unknown>
      const layout: Record<string, number | boolean> = {}
      for (const key of ['left', 'right', 'bottom', 'chat']) {
        const value = source[key]
        if (typeof value === 'number' && value >= 0 && value <= 900) layout[key] = Math.round(value)
      }
      for (const key of ['hideLeft', 'hideRight', 'hideBottom', 'hideChat']) {
        if (typeof source[key] === 'boolean') layout[key] = source[key]
      }
      data.panelLayout = layout
    }
    const preference = await prisma.userPreference.upsert({
      where: { userId: req.user!.id },
      update: data,
      create: { userId: req.user!.id, ...data },
    })
    res.json({ preference })
  }))

  return router
}
