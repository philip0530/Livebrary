import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  canWrite,
  completeCommand,
  createJoinBuffer,
  diffLines,
  documentName,
  effectiveRole,
  parseCommand,
  parseDocumentName,
  redact,
  safeZipPathError,
  weekStart,
} from '@livebrary/shared'
import { keywordHash, pickWeeklyKeyword, WEEKLY_KEYWORDS } from '@livebrary/shared/keywords'
import { decodeTextState, encodeTextState } from '@livebrary/shared/yjs-text'

describe('join buffer', () => {
  it('accepts join without case sensitivity', () => {
    const buffer = createJoinBuffer()
    expect(buffer.push('J').matched).toBe(false)
    expect(buffer.push('o').progress).toBe('jo')
    expect(buffer.push('I').progress).toBe('joi')
    expect(buffer.push('n').matched).toBe(true)
  })

  it('restarts on a wrong letter and supports backspace', () => {
    const buffer = createJoinBuffer()
    buffer.push('j')
    buffer.push('x')
    expect(buffer.value()).toBe('')
    buffer.push('j')
    buffer.push('o')
    buffer.push('Backspace')
    expect(buffer.value()).toBe('j')
  })

  it('resets after three seconds of silence', () => {
    const buffer = createJoinBuffer(3000)
    buffer.push('j', 1_000)
    expect(buffer.push('o', 4_000).progress).toBe('')
    buffer.push('j', 5_000)
    expect(buffer.push('o', 5_100).progress).toBe('jo')
  })
})

describe('week boundary', () => {
  it('rolls at Monday 00:00 Asia/Seoul', () => {
    const before = weekStart(new Date('2026-10-11T14:59:00.000Z'))
    const at = weekStart(new Date('2026-10-11T15:00:00.000Z'))
    expect(before.toISOString()).toBe('2026-10-04T15:00:00.000Z')
    expect(at.toISOString()).toBe('2026-10-11T15:00:00.000Z')
  })
})

describe('weekly keywords', () => {
  it('keeps a diverse pool and avoids the last twelve hashes', () => {
    const seen = new Set<string>()
    for (const word of WEEKLY_KEYWORDS) {
      expect(word).toMatch(/^[a-z]{8,24}$/)
      expect(word).not.toBe('trust')
      expect(word).not.toContain('join')
      expect(seen.has(word)).toBe(false)
      seen.add(word)
    }
    const recent = WEEKLY_KEYWORDS.slice(0, 12).map((word) => keywordHash(word))
    const picked = pickWeeklyKeyword(recent, () => 0)
    expect(recent.includes(keywordHash(picked))).toBe(false)
  })
})

describe('permissions and paths', () => {
  it('treats a public guest as a viewer and a private stranger as nobody', () => {
    expect(effectiveRole(null, 'PUBLIC')).toBe('VIEWER')
    expect(effectiveRole(null, 'PRIVATE')).toBeNull()
    expect(canWrite('VIEWER')).toBe(false)
    expect(canWrite('EDITOR')).toBe(true)
  })

  it('rejects path traversal in zip paths', () => {
    expect(safeZipPathError('src/main.ts')).toBeNull()
    expect(safeZipPathError('../secret')).not.toBeNull()
    expect(safeZipPathError('/etc/passwd')).not.toBeNull()
    expect(parseDocumentName(documentName(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ))?.fileId).toBe('22222222-2222-4222-8222-222222222222')
  })
})

describe('redact and diff', () => {
  it('removes secrets from audit metadata', () => {
    const value = redact({ username: 'ada', password: 'secret', phrase: 'weekly' }) as Record<string, string>
    expect(value.username).toBe('ada')
    expect(value.password).toBe('[redacted]')
    expect(value.phrase).toBe('[redacted]')
  })

  it('shows added and removed lines', () => {
    const lines = diffLines('a\nb', 'a\nc')
    expect(lines).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'add', text: 'c' },
    ])
  })
})

describe('commands', () => {
  it('parses messages and completes file paths', () => {
    expect(parseCommand('/msg ada hello there')?.args).toEqual(['ada', 'hello there'])
    expect(parseCommand('join')).toBeNull()
    expect(completeCommand('/op', ['src/main.ts'])).toContain('/open')
  })
})

describe('crdt text', () => {
  it('merges concurrent inserts instead of replacing the document', () => {
    const left = new Y.Doc()
    const right = new Y.Doc()
    left.getText('monaco').insert(0, 'ab')
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left))
    left.getText('monaco').insert(1, 'X')
    right.getText('monaco').delete(1, 1)
    const leftState = Y.encodeStateVector(left)
    const rightState = Y.encodeStateVector(right)
    Y.applyUpdate(left, Y.encodeStateAsUpdate(right, leftState))
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left, rightState))
    expect(left.getText('monaco').toString()).toBe(right.getText('monaco').toString())
    expect(left.getText('monaco').toString().includes('X')).toBe(true)
  })

  it('round-trips encoded text', () => {
    const state = encodeTextState('print("라이브러리")')
    expect(decodeTextState(state)).toBe('print("라이브러리")')
    expect(createHash('sha256').update(state).digest('hex')).toHaveLength(64)
  })
})
