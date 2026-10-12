import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ApiError, api } from '../lib/api'
import { useSession } from '../stores'

type Panel = 'home' | 'users' | 'projects' | 'security' | 'audit' | 'discord' | 'status'

type Dashboard = {
  users: number
  projects: number
  activeSessions: number
  limitedUsers: number
  database: string
  websocket: { connections: number }
  discord: { connected: boolean; enabled: boolean }
  queue: { pending: number; failed: number }
  weeklyCode: { active: boolean; published: boolean; publishError: string; expiresAt: string | null }
}

const PANELS: [Panel, string, string][] = [
  ['home', '00', 'OVERVIEW'],
  ['users', '01', 'USERS'],
  ['projects', '02', 'PROJECTS'],
  ['security', '03', 'SECURITY'],
  ['audit', '04', 'AUDIT LOGS'],
  ['discord', '05', 'DISCORD BOT'],
  ['status', '06', 'SERVER STATUS'],
]

function stamp(value: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium', hourCycle: 'h23' }).format(new Date(value))
}

export function AdminConsole() {
  const navigate = useNavigate()
  const me = useSession((state) => state.me)
  const [panel, setPanel] = useState<Panel>('home')
  const [clock, setClock] = useState('')
  const [line, setLine] = useState('')
  const [output, setOutput] = useState<string[]>(['LIVEBRARY ADMINISTRATOR CONSOLE', 'AUTHENTICATION: VERIFIED'])
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)

  useEffect(() => {
    const tick = () => setClock(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date()))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    void api<Dashboard>('/api/admin/dashboard').then((data) => {
      setDashboard(data)
      setOutput((rows) => [...rows, `ROLE: ${me?.systemRole ?? 'SYSTEM_ADMIN'}`, 'STATUS: ACTIVE', "type 'help' for console commands"])
    }).catch(() => navigate('/app'))
  }, [me?.systemRole, navigate])

  function print(text: string) {
    setOutput((rows) => [...rows.slice(-200), text])
  }

  async function run(event: React.FormEvent) {
    event.preventDefault()
    const text = line.trim()
    setLine('')
    if (!text) return
    const [name, ...args] = text.split(/\s+/)
    const command = (name ?? '').toLowerCase()
    print(`# ${command === 'fallback' ? 'fallback ********' : text}`)
    if (command === 'exit') {
      await api('/api/admin/exit', { method: 'POST', body: '{}' })
      navigate('/app')
      return
    }
    if (command === 'help') {
      print('users | projects | security | audit | discord | status | limit USER | unlimit USER | revoke USER | test | reissue | fallback CODE | exit')
      return
    }
    if (command === 'users') { setPanel('users'); return }
    if (command === 'projects') { setPanel('projects'); return }
    if (command === 'security') { setPanel('security'); return }
    if (command === 'audit') { setPanel('audit'); return }
    if (command === 'discord') { setPanel('discord'); return }
    if (command === 'status') { setPanel('status'); return }
    if (command === 'test') {
      await api('/api/admin/discord/test', { method: 'POST', body: '{}' }).then(() => print('test queued')).catch((reason) => print(reason instanceof ApiError ? reason.message : 'test failed'))
      return
    }
    if (command === 'reissue') {
      if (!window.confirm('주간 코드를 다시 발급합니다.')) return
      await api('/api/admin/access-code/reissue', { method: 'POST', body: JSON.stringify({ confirm: true }) })
      print('weekly code reissued')
      return
    }
    if (command === 'fallback') {
      const code = args.join('')
      if (!code || !window.confirm('예비 코드를 교체합니다.')) return
      await api('/api/admin/fallback/rotate', { method: 'POST', body: JSON.stringify({ code, confirm: true }) })
      print('fallback credential replaced')
      return
    }
    if (command === 'limit' || command === 'unlimit' || command === 'revoke') {
      const username = args[0]
      if (!username) { print('username required'); return }
      const users = await api<{ users: { id: string; username: string }[] }>(`/api/admin/users?q=${encodeURIComponent(username)}`)
      const user = users.users.find((item) => item.username.toLowerCase() === username.toLowerCase())
      if (!user) { print('user not found'); return }
      if (!window.confirm(`${command} ${user.username}`)) return
      if (command === 'revoke') {
        await api(`/api/admin/users/${user.id}/revoke-sessions`, { method: 'POST', body: JSON.stringify({ confirm: true }) })
      } else {
        await api(`/api/admin/users/${user.id}/limit`, { method: 'POST', body: JSON.stringify({ limited: command === 'limit', confirm: true }) })
      }
      print(`${command} ${user.username}`)
      return
    }
    print('unknown console command')
  }

  const current = PANELS.find(([id]) => id === panel)

  return (
    <div className="shell admin-shell">
      <header className="top">
        <span className="seg brand"><span className="brand-mark">LIVEBRARY</span><span className="admin-tag">ADMIN</span></span>
        <span className="seg"><span className="label">ROLE</span>SYSTEM_ADMIN</span>
        <span className="seg"><span className="dot on" />ACTIVE</span>
        <span className="seg hide-sm"><span className="label">OPERATOR</span>{me?.username}</span>
        <span className="seg mono-num">{clock} <span className="muted">KST</span></span>
        <span className="toggles">
          <button className="cmd danger" onClick={() => void api('/api/admin/exit', { method: 'POST', body: '{}' }).then(() => navigate('/app'))}>EXIT</button>
        </span>
      </header>
      <aside className="pane left">
        <div className="pane-title">Console</div>
        <div className="pane-block grow">
          {PANELS.map(([id, number, label]) => (
            <button key={id} className={panel === id ? 'item active' : 'item'} onClick={() => setPanel(id)}>
              <span className="muted">[{number}]</span><span>{label}</span>
            </button>
          ))}
        </div>
      </aside>
      <div className="resizer" />
      <main className="pane workspace">
        <div className="scroll">
          <div className="view-head">
            <h1>{current?.[2]}</h1>
            <span className="muted">admin session · 15 min</span>
          </div>
          {panel === 'home' && dashboard ? (
            <>
              <div className="stat-grid">
                <div className="stat"><div className="k">USERS</div><div className="v">{dashboard.users}</div></div>
                <div className="stat"><div className="k">PROJECTS</div><div className="v">{dashboard.projects}</div></div>
                <div className="stat"><div className="k">ACTIVE SESSIONS</div><div className="v">{dashboard.activeSessions}</div></div>
                <div className="stat"><div className="k">LIMITED USERS</div><div className={dashboard.limitedUsers ? 'v bad' : 'v'}>{dashboard.limitedUsers}</div></div>
                <div className="stat"><div className="k">DATABASE</div><div className={dashboard.database === 'up' ? 'v' : 'v bad'}>{dashboard.database.toUpperCase()}</div></div>
                <div className="stat"><div className="k">WEBSOCKET</div><div className="v">{dashboard.websocket.connections}</div></div>
                <div className="stat"><div className="k">DISCORD</div><div className={dashboard.discord.connected ? 'v' : 'v bad'}>{dashboard.discord.connected ? 'ONLINE' : 'OFFLINE'}</div></div>
                <div className="stat"><div className="k">LOG QUEUE</div><div className={dashboard.queue.failed ? 'v bad' : 'v'}>{dashboard.queue.pending}<span className="muted" style={{ fontSize: 12 }}> / {dashboard.queue.failed} failed</span></div></div>
              </div>
              <div className="box">
                <span className="box-title">WEEKLY ACCESS CODE</span>
                <div className="field"><span>STATUS</span><span className={dashboard.weeklyCode.active ? 'accent' : 'err'}>{dashboard.weeklyCode.active ? 'ACTIVE' : 'MISSING'}</span></div>
                <div className="field"><span>DISCORD</span><span className={dashboard.weeklyCode.published ? 'accent' : 'warn'}>{dashboard.weeklyCode.published ? 'PUBLISHED' : 'NOT PUBLISHED'}</span></div>
                <div className="field"><span>EXPIRES</span><span className="mono-num">{dashboard.weeklyCode.expiresAt ? stamp(dashboard.weeklyCode.expiresAt) : '—'}</span></div>
                {dashboard.weeklyCode.publishError ? <div className="field"><span>LAST ERROR</span><span className="warn">{dashboard.weeklyCode.publishError}</span></div> : null}
              </div>
            </>
          ) : null}
          {panel === 'users' ? <Users /> : null}
          {panel === 'projects' ? <Projects /> : null}
          {panel === 'security' ? <Security /> : null}
          {panel === 'audit' ? <Audit /> : null}
          {panel === 'discord' ? <DiscordSettings /> : null}
          {panel === 'status' ? <Status /> : null}
          <pre className="console-out">{output.join('\n')}</pre>
        </div>
      </main>
      <footer className="prompt">
        <form onSubmit={(event) => void run(event)}>
          <span className="ps1 err">admin@livebrary:~#</span>
          <input aria-label="admin terminal" autoComplete="off" spellCheck={false} value={line} onChange={(event) => setLine(event.target.value)} />
        </form>
      </footer>
    </div>
  )
}

function Users() {
  const [q, setQ] = useState('')
  const [users, setUsers] = useState<{ id: string; username: string; email: string; status: string; systemRole: string; sessionCount: number }[]>([])
  useEffect(() => {
    void api<{ users: typeof users }>(`/api/admin/users?q=${encodeURIComponent(q)}`).then((data) => setUsers(data.users))
  }, [q])
  return (
    <div className="box">
      <span className="box-title">ACCOUNTS <span className="muted">({users.length})</span></span>
      <label className="field"><span>SEARCH</span><input aria-label="user search" value={q} onChange={(event) => setQ(event.target.value)} placeholder="username or email" /></label>
      <table className="table">
        <thead><tr><th>USER</th><th>EMAIL</th><th>ROLE</th><th>STATUS</th><th className="r">SESSIONS</th></tr></thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.username}</td>
              <td className="muted">{user.email}</td>
              <td className={user.systemRole === 'SYSTEM_ADMIN' ? 'warn' : 'muted'}>{user.systemRole.toLowerCase()}</td>
              <td className={user.status === 'ACTIVE' ? 'accent' : 'err'}>{user.status.toLowerCase()}</td>
              <td className="r mono-num">{user.sessionCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted" style={{ marginTop: 8 }}>limit USER · unlimit USER · revoke USER</div>
    </div>
  )
}

function Projects() {
  const [projects, setProjects] = useState<{ id: string; name: string; visibility: string; owner: string; memberCount: number; updatedAt: string }[]>([])
  useEffect(() => {
    void api<{ projects: typeof projects }>('/api/admin/projects').then((data) => setProjects(data.projects))
  }, [])
  return (
    <div className="box">
      <span className="box-title">PROJECT METADATA <span className="muted">({projects.length})</span></span>
      <table className="table">
        <thead><tr><th>NAME</th><th>ID</th><th>OWNER</th><th>SCOPE</th><th className="r">USERS</th><th>UPDATED</th></tr></thead>
        <tbody>
          {projects.map((project) => (
            <tr key={project.id}>
              <td>{project.name}</td>
              <td className="muted">{project.id.slice(0, 8)}</td>
              <td>{project.owner}</td>
              <td className={project.visibility === 'PUBLIC' ? 'warn' : 'muted'}>{project.visibility.toLowerCase()}</td>
              <td className="r mono-num">{project.memberCount}</td>
              <td className="muted mono-num">{stamp(project.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted" style={{ marginTop: 8 }}>source code of private projects is not shown here</div>
    </div>
  )
}

function EventTable({ rows }: { rows: { id: string; eventType: string; result: string; createdAt: string; actor: { username: string } | null; project?: { name: string } | null }[] }) {
  if (rows.length === 0) return <div className="empty">no events</div>
  return (
    <table className="table">
      <thead><tr><th>TIME</th><th>EVENT</th><th>RESULT</th><th>ACTOR</th><th>PROJECT</th></tr></thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td className="muted mono-num">{stamp(row.createdAt)}</td>
            <td>{row.eventType}</td>
            <td className={row.result === 'SUCCESS' ? 'accent' : 'err'}>{row.result.toLowerCase()}</td>
            <td>{row.actor?.username ?? <span className="muted">system</span>}</td>
            <td className="muted">{row.project?.name ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Security() {
  const [events, setEvents] = useState<{ id: string; eventType: string; result: string; createdAt: string; actor: { username: string } | null }[]>([])
  useEffect(() => {
    void api<{ events: typeof events }>('/api/admin/security').then((data) => setEvents(data.events))
  }, [])
  return <div className="box"><span className="box-title">SECURITY EVENTS <span className="muted">({events.length})</span></span><EventTable rows={events} /></div>
}

function Audit() {
  const [logs, setLogs] = useState<{ id: string; eventType: string; result: string; createdAt: string; actor: { username: string } | null; project: { name: string } | null }[]>([])
  useEffect(() => {
    void api<{ logs: typeof logs }>('/api/admin/audit-logs').then((data) => setLogs(data.logs))
  }, [])
  return <div className="box"><span className="box-title">AUDIT LOG <span className="muted">(latest {logs.length})</span></span><EventTable rows={logs} /></div>
}

function DiscordSettings() {
  const [activity, setActivity] = useState('')
  const [security, setSecurity] = useState('')
  const [developer, setDeveloper] = useState('')
  const [note, setNote] = useState('')
  useEffect(() => {
    void api<{ settings: { activityChannelId: string; securityChannelId: string; developerCodeChannelId: string } }>('/api/admin/discord/settings').then((data) => {
      setActivity(data.settings.activityChannelId)
      setSecurity(data.settings.securityChannelId)
      setDeveloper(data.settings.developerCodeChannelId)
    })
  }, [])
  return (
    <form className="box" onSubmit={(event) => {
      event.preventDefault()
      void api('/api/admin/discord/settings', {
        method: 'PATCH',
        body: JSON.stringify({ activityChannelId: activity, securityChannelId: security, developerCodeChannelId: developer }),
      }).then(() => setNote('saved')).catch((reason) => setNote(reason instanceof ApiError ? reason.message : 'failed'))
    }}>
      <span className="box-title">CHANNEL IDS</span>
      <label className="field"><span>#활동-로그</span><input aria-label="activity channel" value={activity} onChange={(event) => setActivity(event.target.value)} placeholder="channel id" inputMode="numeric" /></label>
      <label className="field"><span>#보안-로그</span><input aria-label="security channel" value={security} onChange={(event) => setSecurity(event.target.value)} placeholder="channel id" inputMode="numeric" /></label>
      <label className="field"><span>#개발자-코드-로그</span><input aria-label="developer code channel" value={developer} onChange={(event) => setDeveloper(event.target.value)} placeholder="channel id" inputMode="numeric" /></label>
      <div className="actions">
        <button className="btn primary" type="submit">SAVE</button>
        <button className="btn" type="button" onClick={() => void api('/api/admin/discord/test', { method: 'POST', body: '{}' }).then(() => setNote('test queued')).catch((reason) => setNote(reason instanceof ApiError ? reason.message : 'failed'))}>SEND TEST</button>
        {note ? <span className="muted">{note}</span> : null}
      </div>
    </form>
  )
}

function Status() {
  const [status, setStatus] = useState<string>('')
  useEffect(() => {
    void api<Record<string, unknown>>('/api/admin/discord/status').then((data) => setStatus(JSON.stringify(data, null, 2)))
  }, [])
  return <div className="box"><span className="box-title">DISCORD / QUEUE</span><pre className="preview" style={{ marginTop: 0 }}>{status}</pre></div>
}
