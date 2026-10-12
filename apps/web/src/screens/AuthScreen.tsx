import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ApiError, api } from '../lib/api'
import { applyTheme, useSession, type Me, type Preference } from '../stores'

const BANNER = String.raw` _    _____   _____ ___ ___    _   _____   __
| |  |_ _\ \ / / __| _ ) _ \  /_\ | _ \ \ / /
| |__ | | \ V /| _|| _ \   / / _ \|   /\ V /
|____|___| \_/ |___|___/_|_\/_/ \_\_|_\ |_| `

export function AuthScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const adminMode = params.get('admin') === '1'
  const setSession = useSession((state) => state.setSession)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [verified, setVerified] = useState(false)
  const [denied, setDenied] = useState('')

  useEffect(() => {
    let cancelled = false
    void api<{ active: boolean }>('/api/gate/status').then((status) => {
      if (!cancelled && !status.active) navigate('/', { replace: true })
    }).catch(() => navigate('/', { replace: true }))
    return () => { cancelled = true }
  }, [navigate])

  async function loadSession() {
    const me = await api<{ user: Me; preference: Preference }>('/api/auth/me')
    setSession(me.user, me.preference)
    applyTheme(me.preference)
  }

  async function confirmCode(form: FormData) {
    setError('')
    setPending(true)
    try {
      await api('/api/admin/access-code', { method: 'POST', body: JSON.stringify({ code: form.get('code') }) })
      navigate('/console')
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '인증에 실패했습니다.')
    } finally {
      setPending(false)
    }
  }

  async function submit(form: FormData) {
    setError('')
    setPending(true)
    try {
      const path = mode === 'login' || adminMode ? '/api/auth/login' : '/api/auth/register'
      const body = mode === 'login' || adminMode
        ? { email: form.get('email'), password: form.get('password') }
        : { email: form.get('email'), username: form.get('username'), password: form.get('password'), passwordConfirm: form.get('passwordConfirm') }
      await api(path, { method: 'POST', body: JSON.stringify(body) })
      await loadSession()
      if (!adminMode) {
        const next = params.get('next')
        navigate(next && next.startsWith('/invite/') && !next.includes('//') ? next : '/app')
        return
      }
      try {
        await api('/api/admin/access/continue', { method: 'POST', body: '{}' })
        setVerified(true)
      } catch (reason) {
        setDenied(reason instanceof ApiError ? reason.message : 'ACCESS DENIED')
      }
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '요청에 실패했습니다.')
    } finally {
      setPending(false)
    }
  }

  const head = (
    <div className="auth-head">
      <pre aria-label="LIVEBRARY">{BANNER}</pre>
      <div className="sub">{adminMode ? '라이브러리 · ADMINISTRATOR ACCESS' : '라이브러리 · REAL-TIME COLLABORATIVE CODE LIBRARY'}</div>
    </div>
  )

  if (adminMode && denied) {
    return (
      <main className="auth">
        <div className="auth-box admin-auth">
          {head}
          <div className="auth-body">
            <div className="err">ACCESS DENIED</div>
            <p className="muted">{denied === 'ACCESS DENIED' ? '이 계정에는 관리자 권한이 없거나 입장 코드 확인이 만료되었습니다.' : denied}</p>
            <div className="auth-foot">
              <span />
              <button className="btn" onClick={() => navigate('/app')}>CONTINUE AS USER</button>
            </div>
          </div>
        </div>
      </main>
    )
  }

  if (adminMode && verified) {
    return (
      <main className="auth">
        <form key="admin-code" className="auth-box admin-auth" onSubmit={(event) => { event.preventDefault(); void confirmCode(new FormData(event.currentTarget)) }}>
          {head}
          <div className="auth-tabs"><button type="button" className="on">ADMIN CODE</button></div>
          <div className="auth-body">
            <label className="field"><span>CODE</span><input name="code" autoComplete="off" autoCapitalize="none" spellCheck={false} required autoFocus /></label>
            {error ? <div className="err">{error}</div> : null}
            <div className="auth-foot">
              <span>이번 주 관리자 입장 코드</span>
              <button className="btn primary" type="submit" disabled={pending}>{pending ? 'WAIT…' : 'CONFIRM'}</button>
            </div>
          </div>
        </form>
      </main>
    )
  }

  return (
    <main className="auth">
      <form className={`auth-box ${adminMode ? 'admin-auth' : ''}`} onSubmit={(event) => { event.preventDefault(); void submit(new FormData(event.currentTarget)) }}>
        {head}
        {adminMode ? (
          <div className="auth-tabs"><button type="button" className="on">ADMINISTRATOR LOGIN</button></div>
        ) : (
          <div className="auth-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'on' : ''} onClick={() => { setMode('login'); setError('') }}>LOGIN</button>
            <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'on' : ''} onClick={() => { setMode('register'); setError('') }}>REGISTER</button>
          </div>
        )}
        <div className="auth-body">
          <label className="field"><span>EMAIL</span><input name="email" type="email" autoComplete="username" required autoFocus /></label>
          {mode === 'register' && !adminMode ? <label className="field"><span>USERNAME</span><input name="username" autoComplete="nickname" required pattern="[A-Za-z0-9_]{3,20}" title="3~20자 영문, 숫자, 밑줄" /></label> : null}
          <label className="field"><span>PASSWORD</span><input name="password" type="password" autoComplete={mode === 'login' || adminMode ? 'current-password' : 'new-password'} required /></label>
          {mode === 'register' && !adminMode ? <label className="field"><span>CONFIRM</span><input name="passwordConfirm" type="password" autoComplete="new-password" required /></label> : null}
          {error ? <div className="err">{error}</div> : null}
          <div className="auth-foot">
            <span>{adminMode ? '입장 코드 확인은 10분간 유효합니다' : mode === 'register' ? 'password: 10+ chars, letters and digits' : 'session is kept on this browser'}</span>
            <button className="btn primary" type="submit" disabled={pending}>{pending ? 'WAIT…' : adminMode ? 'AUTHENTICATE' : mode === 'login' ? 'LOGIN' : 'CREATE ACCOUNT'}</button>
          </div>
        </div>
      </form>
    </main>
  )
}
