import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { LOCALES, TEMPLATE_IDS, THEMES } from '@livebrary/shared'
import { ApiError, api, downloadFile } from '../lib/api'
import { useT, type MessageKey } from '../lib/i18n'
import { useRealtime } from '../lib/realtime'
import { applyTheme, useSession, useTerminal, useWorkspace, type FileRecord, type Me, type Preference, type SyncStatus } from '../stores'
import { filePathMap, loadMessages, logout, openProject, refreshProjects, runCommand } from '../terminal/commands'
import { EditorPane } from '../editor/EditorPane'

const NICK_COLORS = ['#7BD88F', '#6CC7E6', '#E6C07B', '#D48BD4', '#E68B8B', '#8BE0C2', '#C7D36C', '#8BB4E6']
const COMMAND_NAMES = ['help', 'projects', 'create', 'join', 'open', 'files', 'users', 'whoami', 'clear', 'leave', 'logout', 'settings', 'nick', 'msg', 'who', 'me', 'invite']

function nickColor(name: string): string {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return NICK_COLORS[hash % NICK_COLORS.length] ?? '#7BD88F'
}

function sigil(role: string | null | undefined): { mark: string; tone: string } {
  if (role === 'OWNER') return { mark: '@', tone: 'owner' }
  if (role === 'EDITOR') return { mark: '+', tone: 'editor' }
  return { mark: '·', tone: 'viewer' }
}

function roleKey(role: string): MessageKey {
  return role === 'OWNER' ? 'role.OWNER' : role === 'EDITOR' ? 'role.EDITOR' : 'role.VIEWER'
}

function syncDot(sync: SyncStatus): string {
  if (sync === 'CONNECTED' || sync === 'SAVED') return 'on'
  if (sync === 'OFFLINE' || sync === 'ERROR') return 'off'
  if (sync === 'IDLE') return ''
  return 'busy'
}

function toneClass(tone: string): string {
  if (tone === 'error') return 'err'
  if (tone === 'warn') return 'warn'
  if (tone === 'ok') return 'accent'
  return ''
}

function shortTime(value: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value))
}

function stamp(value: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23' }).format(new Date(value))
}

function ChatBody({ content }: { content: string }) {
  const parts = content.split('```')
  return parts.map((part, index) => index % 2 === 1
    ? <pre key={index} className="codeblock">{part.replace(/^\w+\n/, '')}</pre>
    : <span key={index}>{part}</span>)
}

function Tree({ files, parentId, activeId, onOpen, depth = 0 }: { files: FileRecord[]; parentId: string | null; activeId: string | null; onOpen: (file: FileRecord) => void; depth?: number }) {
  const nodes = files.filter((file) => file.parentId === parentId).sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'FOLDER' ? -1 : 1)
  return (
    <div className="tree-children">
      {nodes.map((node, index) => {
        const last = index === nodes.length - 1
        const guide = `${'│ '.repeat(depth)}${last ? '└' : '├'}─`
        return (
          <div key={node.id}>
            <button className={node.id === activeId ? 'item active' : 'item'} onClick={() => node.type === 'FILE' ? onOpen(node) : undefined}>
              <span className="tree-guide">{guide}</span>
              <span className={node.type === 'FOLDER' ? 'accent' : ''}>{node.type === 'FOLDER' ? `${node.name}/` : node.name}</span>
            </button>
            {node.type === 'FOLDER' ? <Tree files={files} parentId={node.id} activeId={activeId} onOpen={onOpen} depth={depth + 1} /> : null}
          </div>
        )
      })}
    </div>
  )
}

export function Shell() {
  const navigate = useNavigate()
  const me = useSession((state) => state.me)
  const preference = useSession((state) => state.preference)
  const setSession = useSession((state) => state.setSession)
  const workspace = useWorkspace()
  const terminal = useTerminal()
  const t = useT()
  const [clock, setClock] = useState('')
  const [draft, setDraft] = useState({ name: '', description: '', visibility: 'PRIVATE', template: 'empty' })
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [input, setInput] = useState('')
  const layout = preference?.panelLayout
  const left = layout?.hideLeft ? 0 : layout?.left ?? 260
  const right = layout?.hideRight ? 0 : layout?.right ?? 230
  const bottom = layout?.hideBottom ? 0 : layout?.bottom ?? 150
  const chat = layout?.hideChat ? 0 : layout?.chat ?? 200
  const paths = useMemo(() => filePathMap(workspace.files), [workspace.files])

  useRealtime()

  useEffect(() => {
    const tick = () => setClock(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date()))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    void api<{ active: boolean }>('/api/gate/status').then(async (gate) => {
      if (!gate.active) { navigate('/'); return }
      const session = await api<{ user: Me; preference: Preference }>('/api/auth/me')
      if (cancelled) return
      setSession(session.user, session.preference)
      applyTheme(session.preference)
      await refreshProjects()
    }).catch(() => navigate('/auth'))
    return () => { cancelled = true }
  }, [navigate, setSession])

  useEffect(() => {
    const reload = () => {
      const project = useWorkspace.getState().project
      if (!project) return
      void api<{ files: FileRecord[] }>(`/api/projects/${project.id}/files`).then((data) => useWorkspace.getState().setFiles(data.files))
    }
    const access = () => {
      const project = useWorkspace.getState().project
      if (project) void openProject(project.id).catch(() => useWorkspace.getState().setProject(null))
    }
    window.addEventListener('lb-files', reload)
    window.addEventListener('lb-access', access)
    return () => {
      window.removeEventListener('lb-files', reload)
      window.removeEventListener('lb-access', access)
    }
  }, [])

  async function saveLayout(partial: Preference['panelLayout']) {
    if (!preference) return
    const panelLayout = { ...preference.panelLayout, ...partial }
    const next = await api<{ preference: Preference }>('/api/settings', { method: 'PATCH', body: JSON.stringify({ panelLayout }) })
    useSession.getState().patchPreference(next.preference)
  }

  async function onTerminal(event: React.FormEvent) {
    event.preventDefault()
    const line = input
    setInput('')
    setHistoryIndex(-1)
    const mode = useTerminal.getState().mode
    if (mode.startsWith('create-')) {
      const draftState = useTerminal.getState().draft
      if (mode === 'create-name') { useTerminal.getState().setDraft({ name: line.trim() }); useTerminal.getState().setMode('create-description'); terminal.print('description:') }
      else if (mode === 'create-description') { useTerminal.getState().setDraft({ description: line.trim() }); useTerminal.getState().setMode('create-visibility'); terminal.print('visibility PRIVATE or PUBLIC:') }
      else if (mode === 'create-visibility') {
        useTerminal.getState().setDraft({ visibility: line.trim().toUpperCase() === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE' })
        useTerminal.getState().setMode('create-template')
        terminal.print(`template ${TEMPLATE_IDS.join(' | ')}:`)
      } else {
        const template = TEMPLATE_IDS.includes(line.trim() as typeof TEMPLATE_IDS[number]) ? line.trim() : 'empty'
        const project = await api<{ project: { id: string } }>('/api/projects', {
          method: 'POST',
          body: JSON.stringify({ name: draftState.name, description: draftState.description, visibility: draftState.visibility, template }),
        })
        useTerminal.getState().setMode('command')
        terminal.print(`created ${project.project.id}`, 'ok')
        await openProject(project.project.id)
      }
      return
    }
    if (!line.startsWith('/')) {
      if (line.trim()) terminal.print('command not found', 'warn')
      return
    }
    terminal.pushHistory(line)
    terminal.print(line, 'info')
    try {
      await runCommand(line)
    } catch (reason) {
      terminal.print(reason instanceof ApiError ? reason.message : 'command failed', 'error')
    }
  }

  if (!me) return <main className="gate" />
  const prompt = `${me.username}@livebrary:~$`
  const project = workspace.project
  const activeChannel = workspace.channels.find((channel) => channel.id === workspace.activeChannelId)
  const activeFile = workspace.files.find((file) => file.id === workspace.activeFileId)
  const mode = terminal.mode
  const allProjects = [...(workspace.projects?.owned ?? []), ...(workspace.projects?.participating ?? [])]
  const showChat = Boolean(chat && project)

  return (
    <div
      className={`shell ${preference?.crt ? 'crt' : ''} ${bottom ? '' : 'no-bottom'}`}
      style={{ ['--left' as string]: `${left}px`, ['--right' as string]: `${right}px`, ['--chat' as string]: `${chat}px`, ['--bottom' as string]: `${bottom}px` }}
    >
      <header className="top">
        <span className="seg brand"><span className="brand-mark">LIVEBRARY</span><span className="muted hide-sm">라이브러리</span></span>
        <span className="seg"><span className="label">{t('top.project')}</span>{project?.name ?? '—'}</span>
        <span className="seg hide-sm"><span className={`dot ${workspace.connected ? 'on' : 'off'}`} />{workspace.connected ? t('top.online') : t('top.offline')}</span>
        <span className="seg hide-sm"><span className="label">{t('top.user')}</span>{me.username}{me.systemRole === 'SYSTEM_ADMIN' ? <span className="warn">*</span> : null}</span>
        <span className="seg mono-num">{clock} <span className="muted">KST</span></span>
        <span className="toggles">
          <button className={`cmd ${layout?.hideLeft ? '' : 'on'}`} title={t('toggle.left')} onClick={() => void saveLayout({ hideLeft: !layout?.hideLeft })}>L</button>
          <button className={`cmd ${layout?.hideChat ? '' : 'on'}`} title={t('toggle.chat')} onClick={() => void saveLayout({ hideChat: !layout?.hideChat })}>{t('btn.chat')}</button>
          <button className={`cmd ${layout?.hideRight ? '' : 'on'}`} title={t('toggle.right')} onClick={() => void saveLayout({ hideRight: !layout?.hideRight })}>R</button>
          <button className={`cmd ${layout?.hideBottom ? '' : 'on'}`} title={t('toggle.log')} onClick={() => void saveLayout({ hideBottom: !layout?.hideBottom })}>{t('btn.log')}</button>
          <button className={`cmd ${workspace.view === 'settings' ? 'on' : ''}`} title={t('toggle.settings')} onClick={() => workspace.setView(workspace.view === 'settings' ? (project ? 'project' : 'dashboard') : 'settings')}>{t('btn.set')}</button>
        </span>
      </header>

      <aside className={left ? 'pane left' : 'hidden-pane'}>
        <div className="pane-title">{t('pane.projects')}<span className="end"><button className={`cmd ${workspace.view === 'dashboard' ? 'on' : ''}`} onClick={() => workspace.setView('dashboard')}>{t('pane.home')}</button></span></div>
        <div className="pane-block">
          {allProjects.length === 0 ? <div className="item muted">{t('pane.noProjects')}</div> : null}
          {allProjects.map((item) => (
            <button key={item.id} className={item.id === project?.id ? 'item active' : 'item'} onClick={() => void openProject(item.id)}>
              <span className={`sigil ${sigil(item.role).tone}`}>{sigil(item.role).mark}</span>
              <span>{item.name}</span>
              <span className="meta">{item.visibility === 'PUBLIC' ? 'pub' : 'prv'}</span>
            </button>
          ))}
        </div>
        {project ? (
          <>
            <div className="pane-title">{t('pane.channels')}</div>
            <div className="pane-block">
              {workspace.channels.map((channel) => (
                <button key={channel.id} className={channel.id === workspace.activeChannelId ? 'item active' : 'item'} onClick={() => void loadMessages(project.id, channel.id)}>
                  <span className="glyph">#</span><span>{channel.name}</span>
                  {channel.unread ? <span className="badge">{channel.unread}</span> : null}
                </button>
              ))}
            </div>
            <div className="pane-title">{t('pane.files')}<span className="end muted">{workspace.files.filter((file) => file.type === 'FILE').length}</span></div>
            <div className="pane-block grow">
              <div className="item muted" style={{ cursor: 'default' }}><span className="accent">{project.name}/</span></div>
              <Tree files={workspace.files} parentId={null} activeId={workspace.activeFileId} onOpen={(file) => workspace.openTab(file)} />
              {project.role !== 'VIEWER' ? <FileCreate projectId={project.id} parentId={null} /> : null}
            </div>
          </>
        ) : null}
      </aside>
      <div className={left ? 'resizer' : 'hidden-pane'} onMouseDown={(event) => dragSize(event, 'left', left, saveLayout)} />

      <main className={`pane center ${showChat ? '' : 'no-chat'}`}>
        <section className="workspace">
          {workspace.view === 'dashboard' ? <div className="scroll"><Dashboard draft={draft} setDraft={setDraft} /></div> : null}
          {workspace.view === 'settings' ? <div className="scroll"><Settings /></div> : null}
          {workspace.view === 'project-settings' && project ? <div className="scroll"><ProjectSettings /></div> : null}
          {workspace.view === 'versions' && project && workspace.activeFileId ? <div className="scroll"><Versions projectId={project.id} fileId={workspace.activeFileId} /></div> : null}
          {workspace.view === 'versions' && !workspace.activeFileId ? <div className="scroll"><div className="view-head"><h1>{t('ver.title')}</h1></div><div className="empty">{t('ver.openFirst')}</div></div> : null}
          {workspace.view === 'project' && project ? (
            <>
              <div className="tabs">
                {workspace.tabs.map((tab) => (
                  <button key={tab.id} className={tab.id === workspace.activeFileId ? 'tab on' : 'tab'} onClick={() => workspace.setActiveFileId(tab.id)}>
                    {tab.name}
                    <span className="close" role="button" aria-label={t('tab.close', { name: tab.name })} onClick={(event) => { event.stopPropagation(); workspace.closeTab(tab.id) }}>×</span>
                  </button>
                ))}
                {project.role === 'VIEWER' ? <span className="readonly-flag">{t('tab.readOnly')}</span> : null}
                <span className="actions">
                  {activeFile ? <button className="cmd" onClick={() => workspace.setView('versions')}>{t('tab.history')}</button> : null}
                  {activeFile ? <button className="cmd" onClick={() => void downloadFile(`/api/projects/${project.id}/files/${activeFile.id}/download`, activeFile.name)}>{t('tab.get')}</button> : null}
                  <button className="cmd" onClick={() => void downloadFile(`/api/projects/${project.id}/export`, `${project.name}.zip`)}>ZIP</button>
                  <button className="cmd" onClick={() => workspace.setView('project-settings')}>{t('tab.project')}</button>
                </span>
              </div>
              <EditorPane />
            </>
          ) : null}
        </section>
        <div className={showChat ? 'row-resizer' : 'hidden-pane'} onMouseDown={(event) => dragSize(event, 'chat', chat, saveLayout)} />
        <section className={showChat ? 'chat' : 'hidden-pane'}>
          <div className="pane-title">
            {activeChannel ? `#${activeChannel.name}` : 'IRC'}
            <span className="end muted">{project ? t('chat.online', { n: workspace.presence.length }) : t('chat.join')}</span>
          </div>
          <div className="chat-log">
            {project && workspace.messages.length === 0 ? <div className="chat-line system"><span className="ts" /><span className="nick sys">***</span><span className="body">{t('chat.empty')}</span></div> : null}
            {workspace.messages.map((message) => {
              const color = { ['--nick' as string]: nickColor(message.username) }
              if (message.kind === 'SYSTEM') {
                return <div key={message.id} className="chat-line system"><span className="ts">{shortTime(message.createdAt)}</span><span className="nick sys">***</span><span className="body">{message.content}</span></div>
              }
              if (message.kind === 'ACTION') {
                return <div key={message.id} className="chat-line action" style={color}><span className="ts">{shortTime(message.createdAt)}</span><span className="nick">*</span><span className="body">{message.username} {message.content}</span></div>
              }
              return (
                <div key={message.id} className="chat-line" style={color}>
                  <span className="ts">{shortTime(message.createdAt)}</span>
                  <span className="nick">&lt;{message.username}&gt;</span>
                  <span className="body"><ChatBody content={message.content} /></span>
                </div>
              )
            })}
          </div>
          {project && workspace.activeChannelId ? <ChatForm projectId={project.id} channelId={workspace.activeChannelId} channelName={activeChannel?.name ?? ''} /> : null}
        </section>
      </main>

      <div className={right ? 'resizer' : 'hidden-pane'} onMouseDown={(event) => dragSize(event, 'right', right, saveLayout)} />
      <aside className={right ? 'pane right' : 'hidden-pane'}>
        <div className="pane-title">{t('pane.online')}<span className="end muted">{workspace.presence.length}</span></div>
        <div className="pane-block who">
          {workspace.presence.length === 0 ? <div className="item muted">{t('pane.nobody')}</div> : null}
          {workspace.presence.map((user) => (
            <div key={user.userId}>
              <div className="item"><span className="dot on" /><span className={`sigil ${sigil(user.role).tone}`}>{sigil(user.role).mark}</span><span style={{ color: nickColor(user.username) }}>{user.username}</span></div>
              {user.fileName ? <div className="file">↳ {user.fileName}</div> : null}
            </div>
          ))}
        </div>
        <div className="pane-title">{t('pane.members')}<span className="end muted">{workspace.members.length}</span></div>
        {/* 초대 창은 버튼 없이 터미널의 /invite 명령으로만 열립니다. */}
        {workspace.invite && project?.role === 'OWNER' ? (
          <div className="pane-block member-add">
            <div className="member-add-head"><span className="accent">/invite</span><button className="cmd" aria-label={t('invite.close')} onClick={() => workspace.setInvite(null)}>×</button></div>
            <InviteForm key={workspace.invite.nonce} projectId={project.id} initial={workspace.invite.name} compact />
          </div>
        ) : null}
        <div className="pane-block who grow">
          {workspace.members.map((member) => (
            <div key={member.userId} className="item">
              <span className={`sigil ${sigil(member.role).tone}`}>{sigil(member.role).mark}</span>
              <span>{member.username}</span>
              <span className="meta">{t(roleKey(member.role))}</span>
            </div>
          ))}
        </div>
      </aside>

      <section className={bottom ? 'bottom' : 'hidden-pane'}>
        <div className="row-resizer" style={{ height: 1 }} onMouseDown={(event) => dragSize(event, 'bottom', bottom, saveLayout)} />
        <div className="pane-title">
          {t('pane.systemLog')}
          <span className="end sync"><span className={`dot ${syncDot(workspace.sync)}`} />SYNC <b>{workspace.sync}</b></span>
        </div>
        <div className="log">
          {terminal.lines.map((line) => (
            <div key={line.id} className={`log-line ${line.tone === 'info' && line.text.startsWith('/') ? 'echo' : toneClass(line.tone)}`}>{line.text}</div>
          ))}
          {workspace.logs.slice(-12).map((line) => (
            <div key={line.id} className={`log-line ${toneClass(line.tone) || 'muted'}`}><span className="muted">*** </span>{line.text}</div>
          ))}
        </div>
      </section>

      <footer className="prompt">
        <form onSubmit={(event) => void onTerminal(event)}>
          <span className="ps1">{prompt}</span>
          <input
            aria-label="terminal"
            autoComplete="off"
            spellCheck={false}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                const next = Math.min(terminal.history.length - 1, historyIndex + 1)
                setHistoryIndex(next)
                setInput(terminal.history[terminal.history.length - 1 - next] ?? '')
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                const next = Math.max(-1, historyIndex - 1)
                setHistoryIndex(next)
                setInput(next < 0 ? '' : terminal.history[terminal.history.length - 1 - next] ?? '')
              }
              if (event.key === 'Tab') {
                event.preventDefault()
                if (input.startsWith('/') && !input.includes(' ')) {
                  const match = COMMAND_NAMES.find((name) => name.startsWith(input.slice(1)))
                  if (match) setInput(`/${match} `)
                }
                if (input.startsWith('/open ')) {
                  const prefix = input.slice(6)
                  const match = [...paths.values()].find((path) => path.startsWith(prefix))
                  if (match) setInput(`/open ${match}`)
                }
              }
            }}
          />
          {mode.startsWith('create-') ? <span className="mode">CREATE · {mode.slice(7)}</span> : null}
        </form>
      </footer>
      <div className="sr-only" aria-live="polite">{terminal.lines.at(-1)?.text}</div>
    </div>
  )
}

function dragSize(event: React.MouseEvent, key: 'left' | 'right' | 'bottom' | 'chat', start: number, save: (value: Preference['panelLayout']) => Promise<void>) {
  event.preventDefault()
  const shell = (event.currentTarget as HTMLElement).closest('.shell') as HTMLElement | null
  const vertical = key === 'bottom' || key === 'chat'
  const origin = vertical ? event.clientY : event.clientX
  const limits = key === 'bottom' ? [60, 480] : key === 'chat' ? [90, 600] : [160, 560]
  const sizeAt = (next: MouseEvent) => {
    const delta = vertical ? origin - next.clientY : key === 'right' ? origin - next.clientX : next.clientX - origin
    return Math.max(limits[0]!, Math.min(limits[1]!, start + delta))
  }
  const move = (next: MouseEvent) => {
    shell?.style.setProperty(`--${key}`, `${sizeAt(next)}px`)
  }
  const up = (next: MouseEvent) => {
    void save({ [key]: sizeAt(next) })
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
    document.body.style.cursor = ''
  }
  document.body.style.cursor = vertical ? 'row-resize' : 'col-resize'
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

type Draft = { name: string; description: string; visibility: string; template: string }

function ProjectTable({ rows, empty, showRole }: { rows: { id: string; name: string; description: string; visibility: string; role: string; memberCount: number; updatedAt: string }[]; empty: string; showRole?: boolean }) {
  const t = useT()
  if (rows.length === 0) return <div className="empty">{empty}</div>
  return (
    <table className="table">
      <thead>
        <tr><th>{t('col.name')}</th><th>ID</th>{showRole ? <th>{t('col.role')}</th> : null}<th className="r">{t('col.users')}</th><th>{t('col.scope')}</th><th>{t('col.updated')}</th></tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="click" onClick={() => void openProject(row.id)} title={row.description}>
            <td>{row.name}</td>
            <td className="muted">{row.id.slice(0, 8)}</td>
            {showRole ? <td>{t(roleKey(row.role))}</td> : null}
            <td className="r mono-num">{row.memberCount}</td>
            <td className={row.visibility === 'PUBLIC' ? 'warn' : 'muted'}>{t(row.visibility === 'PUBLIC' ? 'vis.PUBLIC' : 'vis.PRIVATE')}</td>
            <td className="muted mono-num">{stamp(row.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Dashboard({ draft, setDraft }: { draft: Draft; setDraft: (value: Draft) => void }) {
  const projects = useWorkspace((state) => state.projects)
  const invitations = useWorkspace((state) => state.invitations)
  const me = useSession((state) => state.me)
  const t = useT()
  const [error, setError] = useState('')
  return (
    <>
      <div className="view-head">
        <h1>{t('dash.title')}</h1>
        <span className="muted">{t('dash.welcome', { name: me?.username ?? '' })}</span>
        <span className="end hint">/create · /join [ID] · /help</span>
      </div>
      <div className="box">
        <span className="box-title">{t('dash.owned')} <span className="muted">({projects?.owned.length ?? 0})</span></span>
        <ProjectTable rows={projects?.owned ?? []} empty={t('dash.noOwned')} />
      </div>
      <div className="box">
        <span className="box-title">{t('dash.participating')} <span className="muted">({projects?.participating.length ?? 0})</span></span>
        <ProjectTable rows={projects?.participating ?? []} empty={t('dash.noShared')} showRole />
      </div>
      <div className="box-grid">
        <div className="box">
          <span className="box-title">{t('dash.recent')}</span>
          {(projects?.recent ?? []).length === 0 ? <div className="empty">{t('dash.noRecent')}</div> : null}
          {projects?.recent.map((item) => (
            <button key={item.id} className="item" style={{ paddingLeft: 0 }} onClick={() => void openProject(item.id)}>
              <span className="glyph">›</span><span>{item.name}</span>
              <span className="meta">{item.lastOpenedAt ? stamp(item.lastOpenedAt) : ''}</span>
            </button>
          ))}
        </div>
        <div className="box">
          <span className="box-title">{t('dash.invites')} <span className="muted">({invitations.length})</span></span>
          {invitations.length === 0 ? <div className="empty">{t('dash.noInvites')}</div> : null}
          {invitations.map((invite) => (
            <div key={invite.id} className="item" style={{ paddingLeft: 0 }}>
              <span>{invite.projectName}</span><span className="muted">{t(roleKey(invite.role))}</span>
              <span className="meta">
                <button className="cmd" onClick={() => void api(`/api/invitations/by-id/${invite.id}/accept`, { method: 'POST', body: '{}' }).then(() => refreshProjects())}>{t('dash.accept')}</button>{' '}
                <button className="cmd danger" onClick={() => void api(`/api/invitations/by-id/${invite.id}/decline`, { method: 'POST', body: '{}' }).then(() => refreshProjects())}>{t('dash.decline')}</button>
              </span>
            </div>
          ))}
        </div>
      </div>
      <form className="box" onSubmit={(event) => {
        event.preventDefault()
        setError('')
        void api<{ project: { id: string } }>('/api/projects', { method: 'POST', body: JSON.stringify(draft) })
          .then((result) => openProject(result.project.id))
          .catch((reason) => setError(reason instanceof ApiError ? reason.message : t('common.failed')))
      }}>
        <span className="box-title">{t('dash.newProject')}</span>
        <label className="field"><span>{t('field.name')}</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required maxLength={80} /></label>
        <label className="field"><span>{t('field.description')}</span><input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} maxLength={500} /></label>
        <label className="field"><span>{t('field.scope')}</span>
          <select value={draft.visibility} onChange={(event) => setDraft({ ...draft, visibility: event.target.value })}>
            <option value="PRIVATE">{t('scope.private')}</option>
            <option value="PUBLIC">{t('scope.public')}</option>
          </select>
        </label>
        <label className="field"><span>{t('field.template')}</span>
          <select value={draft.template} onChange={(event) => setDraft({ ...draft, template: event.target.value })}>
            {TEMPLATE_IDS.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
        <div className="actions">
          <button className="btn primary" type="submit">{t('dash.create')}</button>
          {error ? <span className="err">{error}</span> : null}
        </div>
      </form>
    </>
  )
}

function FileCreate({ projectId, parentId }: { projectId: string; parentId: string | null }) {
  const t = useT()
  const [name, setName] = useState('')
  return (
    <form className="new-entry" onSubmit={(event) => {
      event.preventDefault()
      if (!name.trim()) return
      const type = name.endsWith('/') ? 'FOLDER' : 'FILE'
      void api(`/api/projects/${projectId}/files`, { method: 'POST', body: JSON.stringify({ parentId, name: name.replace(/\/$/, ''), type }) })
        .then(() => api<{ files: FileRecord[] }>(`/api/projects/${projectId}/files`))
        .then((data) => useWorkspace.getState().setFiles(data.files))
      setName('')
    }}>
      <span>+</span>
      <input aria-label="new file" placeholder={t('pane.newFile')} value={name} onChange={(event) => setName(event.target.value)} />
    </form>
  )
}

function ChatForm({ projectId, channelId, channelName }: { projectId: string; channelId: string; channelName: string }) {
  const t = useT()
  const [text, setText] = useState('')
  return (
    <form className="chat-input" onSubmit={(event) => {
      event.preventDefault()
      if (!text.trim()) return
      void api(`/api/projects/${projectId}/channels/${channelId}/messages`, { method: 'POST', body: JSON.stringify({ content: text }) })
      setText('')
    }}>
      <span className="chan">[#{channelName}]</span>
      <input aria-label="chat" value={text} onChange={(event) => setText(event.target.value)} placeholder={t('chat.placeholder')} autoComplete="off" />
    </form>
  )
}

function Settings() {
  const me = useSession((state) => state.me)
  const preference = useSession((state) => state.preference)
  const t = useT()
  if (!me || !preference) return null
  async function patch(body: object) {
    const next = await api<{ preference?: Preference; user?: Me }>('/api/settings', { method: 'PATCH', body: JSON.stringify(body) })
    if (next.preference) {
      useSession.getState().patchPreference(next.preference)
      applyTheme(next.preference)
    }
  }
  return (
    <>
      <div className="view-head">
        <h1>{t('set.title')}</h1>
        <span className="muted">{me.username}</span>
        <span className="end"><button className="btn danger" onClick={() => void logout().then(() => location.assign('/'))}>{t('set.logout')}</button></span>
      </div>
      <div className="box-grid">
        <div className="box">
          <span className="box-title">{t('set.terminal')}</span>
          <label className="field"><span>{t('set.language')}</span>
            <select value={preference.locale} onChange={(event) => void patch({ locale: event.target.value })}>
              {LOCALES.map((locale) => <option key={locale.id} value={locale.id}>{locale.label}</option>)}
            </select>
          </label>
          <label className="field"><span>{t('set.theme')}</span>
            <select value={preference.theme} onChange={(event) => void patch({ theme: event.target.value })}>
              {THEMES.map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={preference.crt} onChange={(event) => void patch({ crt: event.target.checked })} />{t('set.crt')}</label>
          <label className="check"><input type="checkbox" checked={preference.notifications} onChange={(event) => void patch({ notifications: event.target.checked })} />{t('set.notifications')}</label>
        </div>
        <div className="box">
          <span className="box-title">{t('set.editor')}</span>
          <label className="field"><span>{t('set.fontSize')}</span><input type="number" min={10} max={32} value={preference.fontSize} onChange={(event) => void patch({ fontSize: Number(event.target.value) })} /></label>
          <label className="field"><span>{t('set.tabWidth')}</span>
            <select value={preference.tabSize} onChange={(event) => void patch({ tabSize: Number(event.target.value) })}>
              <option value={2}>2</option><option value={4}>4</option><option value={8}>8</option>
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={preference.lineNumbers} onChange={(event) => void patch({ lineNumbers: event.target.checked })} />{t('set.lineNumbers')}</label>
          <label className="check"><input type="checkbox" checked={preference.wordWrap} onChange={(event) => void patch({ wordWrap: event.target.checked })} />{t('set.wordWrap')}</label>
          <label className="check"><input type="checkbox" checked={preference.minimap} onChange={(event) => void patch({ minimap: event.target.checked })} />{t('set.minimap')}</label>
        </div>
      </div>
      <ProfileForm />
    </>
  )
}

function ProfileForm() {
  const me = useSession((state) => state.me)!
  const t = useT()
  const [bio, setBio] = useState(me.bio)
  const [language, setLanguage] = useState(me.primaryLanguage)
  const [saved, setSaved] = useState(false)
  return (
    <form className="box" onSubmit={(event) => {
      event.preventDefault()
      setSaved(false)
      void api('/api/profile', { method: 'PATCH', body: JSON.stringify({ bio, primaryLanguage: language }) }).then(async () => {
        const next = await api<{ user: Me; preference: Preference }>('/api/auth/me')
        useSession.getState().setSession(next.user, next.preference)
        setSaved(true)
      })
    }}>
      <span className="box-title">{t('profile.title')}</span>
      <div className="field"><span>{t('profile.username')}</span><span>{me.username} <span className="muted">· /nick [name]</span></span></div>
      <div className="field"><span>{t('profile.email')}</span><span className="muted">{me.email} {t('profile.private')}</span></div>
      <label className="field"><span>{t('profile.bio')}</span><input value={bio} onChange={(event) => setBio(event.target.value)} maxLength={280} /></label>
      <label className="field"><span>{t('profile.mainLanguage')}</span><input value={language} onChange={(event) => setLanguage(event.target.value)} maxLength={40} placeholder="TypeScript, Python, ..." /></label>
      <div className="actions">
        <button className="btn primary" type="submit">{t('common.save')}</button>
        {saved ? <span className="accent">{t('common.saved')}</span> : null}
      </div>
    </form>
  )
}

function InviteForm({ projectId, compact, initial = '' }: { projectId: string; compact?: boolean; initial?: string }) {
  const t = useT()
  const [invite, setInvite] = useState(initial)
  const [role, setRole] = useState('EDITOR')
  const [sent, setSent] = useState<{ name: string; link: string } | null>(null)
  const [error, setError] = useState('')
  return (
    <form className={compact ? 'invite compact' : 'invite'} onSubmit={(event) => {
      event.preventDefault()
      const target = invite.trim()
      if (!target) return
      setError('')
      setSent(null)
      const email = target.includes('@')
      void api<{ link: string }>(`/api/projects/${projectId}/invitations`, { method: 'POST', body: JSON.stringify({ username: email ? undefined : target, email: email ? target : undefined, role }) })
        .then((result) => { setSent({ name: target, link: result.link }); setInvite('') })
        .catch((reason) => setError(reason instanceof ApiError ? reason.message : t('invite.failed')))
    }}>
      <label className="field"><span>{t('invite.label')}</span><input value={invite} onChange={(event) => setInvite(event.target.value)} placeholder={t('invite.placeholder')} autoFocus={compact} required /></label>
      <label className="field"><span>{t('invite.as')}</span>
        <select value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="EDITOR">{t('invite.editor')}</option>
          <option value="VIEWER">{t('invite.viewer')}</option>
        </select>
      </label>
      <div className="actions">
        <button className="btn primary" type="submit">{t('invite.send')}</button>
        {error ? <span className="err">{error}</span> : null}
      </div>
      {sent ? <><div className="accent invite-sent">{t('invite.sent', { name: sent.name })}</div><div className="linkbox">{sent.link}</div></> : null}
    </form>
  )
}

function ProjectSettings() {
  const project = useWorkspace((state) => state.project)
  const members = useWorkspace((state) => state.members)
  const t = useT()
  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  if (!project) return null
  const owner = project.role === 'OWNER'
  return (
    <>
      <div className="view-head">
        <h1>{project.name.toUpperCase()}</h1>
        <span className="muted">{project.id}</span>
        <span className="end"><button className="cmd" onClick={() => useWorkspace.getState().setView('project')}>{t('common.back')}</button></span>
      </div>
      <div className="box">
        <span className="box-title">{t('proj.section')}</span>
        {owner ? (
          <form onSubmit={(event) => { event.preventDefault(); void api(`/api/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify({ name, description }) }).then(() => openProject(project.id)) }}>
            <label className="field"><span>{t('field.name')}</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label className="field"><span>{t('field.description')}</span><input value={description} onChange={(event) => setDescription(event.target.value)} /></label>
            <div className="field"><span>{t('field.scope')}</span><span>
              <span className={project.visibility === 'PUBLIC' ? 'warn' : ''}>{t(project.visibility === 'PUBLIC' ? 'vis.PUBLIC' : 'vis.PRIVATE')}</span>{' '}
              <button type="button" className="cmd" onClick={() => void api(`/api/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify({ visibility: project.visibility === 'PUBLIC' ? 'PRIVATE' : 'PUBLIC' }) }).then(() => openProject(project.id))}>
                {project.visibility === 'PUBLIC' ? t('proj.makePrivate') : t('proj.makePublic')}
              </button>
            </span></div>
            <div className="actions"><button className="btn primary" type="submit">{t('common.save')}</button></div>
          </form>
        ) : (
          <>
            <div className="field"><span>{t('field.description')}</span><span>{project.description || '—'}</span></div>
            <div className="field"><span>{t('proj.yourRole')}</span><span>{t(roleKey(project.role))}</span></div>
          </>
        )}
      </div>
      <div className="box">
        <span className="box-title">{t('proj.members')} <span className="muted">({members.length})</span></span>
        <table className="table">
          <thead><tr><th /><th>{t('col.user')}</th><th>{t('col.role')}</th><th className="r">{owner ? t('col.actions') : ''}</th></tr></thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.userId}>
                <td className={`sigil ${sigil(member.role).tone}`}>{sigil(member.role).mark}</td>
                <td>{member.username}</td>
                <td className="muted">{t(roleKey(member.role))}</td>
                <td className="r">
                  {owner && member.role !== 'OWNER' ? (
                    <>
                      <button className="cmd" onClick={() => void api(`/api/projects/${project.id}/members/${member.userId}`, { method: 'PATCH', body: JSON.stringify({ role: member.role === 'EDITOR' ? 'VIEWER' : 'EDITOR' }) }).then(() => openProject(project.id))}>
                        → {t(member.role === 'EDITOR' ? 'role.VIEWER' : 'role.EDITOR')}
                      </button>{' '}
                      <button className="cmd danger" onClick={() => { if (window.confirm(t('proj.kickConfirm', { name: member.username }))) void api(`/api/projects/${project.id}/members/${member.userId}`, { method: 'DELETE' }).then(() => openProject(project.id)) }}>{t('proj.kick')}</button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {owner ? <div className="muted invite-hint">{t('invite.hint')} <span className="accent">/invite [user]</span></div> : null}
      </div>
      {owner ? (
        <div className="box" style={{ borderColor: 'rgba(255,107,107,0.4)' }}>
          <span className="box-title err">{t('proj.danger')}</span>
          <div className="actions" style={{ marginTop: 0 }}>
            <button className="btn danger" onClick={() => { if (window.confirm(t('proj.deleteConfirm'))) void api(`/api/projects/${project.id}`, { method: 'DELETE' }).then(() => { useWorkspace.getState().setProject(null); useWorkspace.getState().setView('dashboard'); void refreshProjects() }) }}>{t('proj.delete')}</button>
            <span className="muted">{t('proj.deleteHint')}</span>
          </div>
        </div>
      ) : null}
    </>
  )
}

function Versions({ projectId, fileId }: { projectId: string; fileId: string }) {
  const file = useWorkspace((state) => state.files.find((item) => item.id === fileId))
  const role = useWorkspace((state) => state.project?.role)
  const t = useT()
  const [rows, setRows] = useState<{ id: string; kind: string; createdAt: string; author: string }[]>([])
  const [preview, setPreview] = useState<{ title: string; lines: { type: string; text: string }[] } | null>(null)
  const writable = role === 'OWNER' || role === 'EDITOR'
  const reload = () => api<{ snapshots: typeof rows }>(`/api/projects/${projectId}/files/${fileId}/snapshots`).then((data) => setRows(data.snapshots))
  useEffect(() => { void reload() }, [fileId, projectId])
  return (
    <>
      <div className="view-head">
        <h1>{t('ver.title')}</h1>
        <span className="muted">{file?.name}</span>
        <span className="end">
          {writable ? <button className="cmd" onClick={() => void api(`/api/projects/${projectId}/files/${fileId}/snapshots`, { method: 'POST', body: '{}' }).then(reload)}>{t('ver.snapshotNow')}</button> : null}{' '}
          <button className="cmd" onClick={() => useWorkspace.getState().setView('project')}>{t('common.back')}</button>
        </span>
      </div>
      <div className="box">
        <span className="box-title">{t('ver.snapshots')} <span className="muted">({rows.length})</span></span>
        {rows.length === 0 ? <div className="empty">{t('ver.none')}</div> : (
          <table className="table">
            <thead><tr><th>{t('col.time')}</th><th>{t('col.kind')}</th><th>{t('col.by')}</th><th className="r" /></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="mono-num">{stamp(row.createdAt)}</td>
                  <td className={row.kind === 'PRE_RESTORE' ? 'warn' : 'muted'}>{row.kind.toLowerCase()}</td>
                  <td>{row.author}</td>
                  <td className="r">
                    <button className="cmd" onClick={() => void api<{ snapshot: { text: string } }>(`/api/projects/${projectId}/files/${fileId}/snapshots/${row.id}`).then((data) => setPreview({ title: `${t('ver.view')} ${stamp(row.createdAt)}`, lines: data.snapshot.text.split('\n').map((text) => ({ type: 'same', text })) }))}>{t('ver.view')}</button>{' '}
                    <button className="cmd" onClick={() => void api<{ lines: { type: string; text: string }[] }>(`/api/projects/${projectId}/files/${fileId}/snapshots/${row.id}/diff`).then((data) => setPreview({ title: `${t('ver.diff')} ${stamp(row.createdAt)} → now`, lines: data.lines }))}>{t('ver.diff')}</button>{' '}
                    {writable ? <button className="cmd danger" onClick={() => { if (window.confirm(t('ver.restoreConfirm'))) void api(`/api/projects/${projectId}/files/${fileId}/snapshots/${row.id}/restore`, { method: 'POST', body: '{}' }).then(reload) }}>{t('ver.restore')}</button> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {preview ? (
        <div className="box">
          <span className="box-title">{preview.title}</span>
          <pre className="preview" style={{ marginTop: 0 }}>
            {preview.lines.map((line, index) => (
              <div key={index} className={line.type === 'add' ? 'add' : line.type === 'del' ? 'del' : ''}>{line.type === 'add' ? '+ ' : line.type === 'del' ? '- ' : '  '}{line.text}</div>
            ))}
          </pre>
        </div>
      ) : null}
    </>
  )
}
