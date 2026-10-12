import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import QRCode from 'qrcode'
import { ApiError, api } from '../lib/api'

type Phase = 'loading' | 'waiting' | 'expired' | 'denied' | 'error'

export function AdminDiscordQr() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('loading')
  const [qr, setQr] = useState('')
  const [link, setLink] = useState('')
  const [expiresAt, setExpiresAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [message, setMessage] = useState('')
  const alive = useRef(true)

  async function start() {
    setPhase('loading')
    setMessage('')
    try {
      const result = await api<{ authorizeUrl: string; expiresAt: string }>('/api/admin/discord-auth/start', { method: 'POST', body: '{}' })
      if (!alive.current) return
      setLink(result.authorizeUrl)
      setExpiresAt(new Date(result.expiresAt).getTime())
      setQr(await QRCode.toString(result.authorizeUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } }))
      setPhase('waiting')
    } catch (reason) {
      setPhase('error')
      setMessage(reason instanceof ApiError ? reason.message : 'QR을 만들지 못했습니다.')
    }
  }

  useEffect(() => {
    alive.current = true
    void start()
    return () => { alive.current = false }
  }, [])

  useEffect(() => {
    if (phase !== 'waiting') return
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    const poll = window.setInterval(() => {
      void api<{ status: string }>('/api/admin/discord-auth/poll', { method: 'POST', body: '{}' }).then((result) => {
        if (!alive.current) return
        if (result.status === 'approved') navigate('/console')
        else if (result.status === 'denied') setPhase('denied')
        else if (result.status === 'expired' || result.status === 'none') setPhase('expired')
      }).catch(() => undefined)
    }, 2000)
    return () => {
      window.clearInterval(tick)
      window.clearInterval(poll)
    }
  }, [phase, navigate])

  const left = Math.max(0, Math.ceil((expiresAt - now) / 1000))
  useEffect(() => {
    if (phase === 'waiting' && expiresAt && left === 0) setPhase('expired')
  }, [left, phase, expiresAt])

  return (
    <div className="discord-qr">
      {phase === 'waiting' ? (
        <>
          <div className="qr-frame" dangerouslySetInnerHTML={{ __html: qr }} aria-label="Discord 로그인 QR" role="img" />
          <ol className="qr-steps">
            <li>휴대폰 카메라로 QR을 찍습니다</li>
            <li>Discord에서 <span className="accent">승인</span>을 누릅니다</li>
            <li>이 화면이 자동으로 관리자 콘솔로 넘어갑니다</li>
          </ol>
          <div className="auth-foot">
            <span className="mono-num">{left}s · waiting for Discord…</span>
            <a className="btn" href={link} target="_blank" rel="noreferrer">이 기기에서 열기</a>
          </div>
        </>
      ) : null}
      {phase === 'loading' ? <p className="muted">QR 준비 중…</p> : null}
      {phase === 'expired' ? (
        <>
          <div className="warn">QR이 만료되었습니다</div>
          <div className="auth-foot"><span /><button className="btn primary" onClick={() => void start()}>새 QR</button></div>
        </>
      ) : null}
      {phase === 'denied' ? (
        <>
          <div className="err">승인이 거부되었습니다</div>
          <p className="muted">이 관리자 계정에 연결된 Discord 계정으로 승인해야 합니다.</p>
          <div className="auth-foot"><span /><button className="btn primary" onClick={() => void start()}>다시 시도</button></div>
        </>
      ) : null}
      {phase === 'error' ? (
        <>
          <div className="err">{message}</div>
          <div className="auth-foot">
            <button className="btn" onClick={() => navigate('/')}>처음으로</button>
            <button className="btn primary" onClick={() => void start()}>다시 시도</button>
          </div>
        </>
      ) : null}
    </div>
  )
}
