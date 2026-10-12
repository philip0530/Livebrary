import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { createJoinBuffer } from '@livebrary/shared'
import { api } from '../lib/api'
import { destinationAfterEntry, passEntry } from '../lib/entry'

const BOOT = `LIVEBRARY SYSTEM

INITIALIZING CONNECTION...

[OK] ENTRY SEQUENCE ACCEPTED
[OK] SYSTEM INITIALIZED
[OK] TERMINAL READY

WELCOME TO LIVEBRARY`

const ADMIN_BOOT = `LIVEBRARY SYSTEM

INITIALIZING SECURE CHANNEL...

[OK] OPERATOR CODE ACCEPTED
[..] ADMINISTRATOR LOGIN REQUIRED
[..] SECOND FACTOR REQUIRED

AUTHENTICATE TO CONTINUE`

const IDLE_RESET_MS = 3000
const MAX_TYPED = 64

export function GateScreen() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<'black' | 'boot' | 'leave'>('black')
  const [admin, setAdmin] = useState(false)
  const [armed, setArmed] = useState(false)
  const [progress, setProgress] = useState('')
  const buffer = useRef(createJoinBuffer(IDLE_RESET_MS))
  const typed = useRef({ value: '', at: 0 })
  const entered = useRef(false)
  const checking = useRef(false)
  const consumed = useRef('')

  useEffect(() => {
    if (!armed || phase !== 'black') return
    buffer.current.reset()
    typed.current = { value: '', at: 0 }
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
      if (event.key === 'Enter') {
        event.preventDefault()
        void submitTyped()
        return
      }
      const letter = event.key.length === 1 && /^[a-z]$/i.test(event.key)
      if (event.key !== 'Backspace' && !letter) return
      event.preventDefault()
      consumed.current = letter ? event.key : ''
      accept(event.key)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [armed, phase])

  function remember(key: string) {
    const now = Date.now()
    const state = typed.current
    if (state.at && now - state.at >= IDLE_RESET_MS) state.value = ''
    state.at = now
    if (key === 'Backspace') state.value = state.value.slice(0, -1)
    else state.value = (state.value + key.toLowerCase()).slice(-MAX_TYPED)
  }

  function accept(key: string) {
    if (entered.current) return
    remember(key)
    const result = buffer.current.push(key)
    setProgress(result.progress)
    if (!result.matched) return
    typed.current = { value: '', at: 0 }
    void enter()
  }

  async function submitTyped() {
    if (entered.current || checking.current) return
    const state = typed.current
    const phrase = state.at && Date.now() - state.at < IDLE_RESET_MS ? state.value : ''
    typed.current = { value: '', at: 0 }
    buffer.current.reset()
    if (phrase.length < 4) return
    checking.current = true
    try {
      await api('/api/gate/admin', { method: 'POST', body: JSON.stringify({ phrase }) })
      entered.current = true
      passEntry()
      setAdmin(true)
      setPhase('boot')
      window.setTimeout(() => setPhase('leave'), 900)
      window.setTimeout(() => navigate('/auth?admin=1'), 1300)
    } catch {
      setProgress('')
    } finally {
      checking.current = false
    }
  }

  async function enter() {
    if (entered.current) return
    entered.current = true
    await api('/api/gate/enter', { method: 'POST', body: '{}' })
    passEntry()
    const me = await api<{ user: { id: string } }>('/api/auth/me').catch(() => null)
    const next = destinationAfterEntry(Boolean(me))
    setPhase('boot')
    window.setTimeout(() => setPhase('leave'), 700)
    window.setTimeout(() => navigate(next), 1100)
  }

  const boot = admin ? ADMIN_BOOT : BOOT

  return (
    <main className={`gate ${phase === 'leave' ? 'fade-out' : ''}`} data-testid="gate-root" data-progress={progress} onPointerDown={() => setArmed(true)}>
      <button className="sr-only" type="button" onClick={() => void enter()}>Livebrary 입장</button>
      {armed && phase === 'black' ? (
        <input
          className="gate-capture"
          aria-label="입장 문자열"
          autoFocus
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          onInput={(event) => {
            const value = event.currentTarget.value
            event.currentTarget.value = ''
            if (!value) return
            if (consumed.current && value.toLowerCase() === consumed.current.toLowerCase()) {
              consumed.current = ''
              return
            }
            consumed.current = ''
            for (const char of value) if (/^[a-z]$/i.test(char)) accept(char)
          }}
        />
      ) : null}
      {phase !== 'black' ? (
        <pre className={`boot ${admin ? 'boot-admin' : ''}`} data-testid="boot-text">
          {boot.split('\n').map((line, index) => (
            <span
              key={index}
              className={line.startsWith('[OK]') ? 'boot-ok' : line.startsWith('[..]') ? 'boot-wait' : line.startsWith('WELCOME') || line.startsWith('LIVEBRARY') || line.startsWith('AUTHENTICATE') ? 'boot-title' : ''}
              style={{ animationDelay: `${index * 55}ms` }}
            >
              {line}
            </span>
          ))}
        </pre>
      ) : null}
    </main>
  )
}
