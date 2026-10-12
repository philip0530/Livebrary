import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ApiError, api } from '../lib/api'

export function InvitePage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const [message, setMessage] = useState('checking session…')
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    void api<{ active: boolean }>('/api/gate/status').then(async (gate) => {
      if (!gate.active) {
        navigate('/')
        return
      }
      await api('/api/auth/me')
      setReady(true)
      setMessage('이 프로젝트에 초대되었습니다. 수락하면 바로 참여합니다.')
    }).catch(() => navigate('/auth'))
  }, [navigate])

  async function respond(action: 'accept' | 'decline') {
    try {
      await api<{ projectId?: string }>(`/api/invitations/${token}/${action}`, { method: 'POST', body: '{}' })
      navigate('/app')
    } catch (reason) {
      setFailed(true)
      setMessage(reason instanceof ApiError ? reason.message : '초대 처리에 실패했습니다.')
    }
  }

  return (
    <main className="auth">
      <div className="auth-box invite-box">
        <div className="auth-head">
          <pre>{'LIVEBRARY // INVITE'}</pre>
          <div className="sub">라이브러리 · PROJECT INVITATION</div>
        </div>
        <div className="auth-body">
          <p className={failed ? 'err' : 'muted'}>{message}</p>
          {ready ? (
            <div className="auth-foot">
              <button className="btn" onClick={() => void respond('decline')}>DECLINE</button>
              <button className="btn primary" onClick={() => void respond('accept')}>ACCEPT</button>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  )
}
