import { api, clearLocalUserData, downloadFile } from '../lib/api'
import { disconnectRealtime } from '../lib/realtime'
import { applyTheme, useSession, useTerminal, useWorkspace, type FileRecord, type Me, type Preference } from '../stores'

export function filePathMap(files: FileRecord[]): Map<string, string> {
  const byId = new Map(files.map((file) => [file.id, file]))
  const paths = new Map<string, string>()
  const visit = (id: string): string => {
    const cached = paths.get(id)
    if (cached) return cached
    const file = byId.get(id)
    if (!file) return ''
    const parent = file.parentId ? visit(file.parentId) : ''
    const value = parent ? `${parent}/${file.name}` : file.name
    paths.set(id, value)
    return value
  }
  for (const file of files) visit(file.id)
  return paths
}

export async function refreshProjects(): Promise<void> {
  const [projects, invitations] = await Promise.all([
    api<{ owned: [], participating: [], recent: [] }>('/api/projects'),
    api<{ invitations: { id: string; projectId: string; projectName: string; role: string; expiresAt: string | null }[] }>('/api/invitations'),
  ])
  useWorkspace.getState().setProjects(projects)
  useWorkspace.getState().setInvitations(invitations.invitations)
}

export async function openProject(id: string): Promise<void> {
  const detail = await api<{ project: { id: string; name: string; description: string; visibility: 'PRIVATE' | 'PUBLIC'; ownerId: string; role: 'OWNER' | 'EDITOR' | 'VIEWER'; memberCount: number; updatedAt: string } }>(`/api/projects/${id}`)
  await api(`/api/projects/${id}/open`, { method: 'POST', body: '{}' })
  const [files, channels, members] = await Promise.all([
    api<{ files: FileRecord[] }>(`/api/projects/${id}/files`),
    api<{ channels: { id: string; name: string; unread: number }[] }>(`/api/projects/${id}/channels`),
    api<{ members: { userId: string; username: string; role: string; avatarUrl: string | null; primaryLanguage: string }[] }>(`/api/projects/${id}/members`),
  ])
  const store = useWorkspace.getState()
  store.setProject({ ...detail.project, description: detail.project.description })
  store.setFiles(files.files)
  store.setChannels(channels.channels)
  store.setMembers(members.members)
  store.setActiveChannelId(channels.channels[0]?.id ?? null)
  store.setMessages([])
  store.setView('project')
  if (channels.channels[0]) await loadMessages(id, channels.channels[0].id)
  const { subscribeProject } = await import('../lib/realtime')
  subscribeProject(id)
  store.log(`entered ${detail.project.name}`, 'ok')
}

export async function loadMessages(projectId: string, channelId: string): Promise<void> {
  const data = await api<{ messages: { id: string; channelId: string; username: string; content: string; kind: 'MESSAGE' | 'ACTION' | 'SYSTEM'; createdAt: string }[] }>(`/api/projects/${projectId}/channels/${channelId}/messages`)
  useWorkspace.getState().setMessages(data.messages)
  useWorkspace.getState().setActiveChannelId(channelId)
  await api(`/api/projects/${projectId}/channels/${channelId}/read`, { method: 'POST', body: '{}' })
}

export async function logout(): Promise<void> {
  await api('/api/auth/logout', { method: 'POST', body: '{}' }).catch(() => undefined)
  disconnectRealtime()
  await clearLocalUserData()
  useSession.getState().clear()
  useWorkspace.getState().reset()
  useTerminal.getState().clear()
  applyTheme(null)
}

export async function runCommand(line: string): Promise<void> {
  const print = useTerminal.getState().print
  const [name, ...args] = line.slice(1).trim().split(/\s+/)
  const command = (name ?? '').toLowerCase()
  const rest = line.slice(1).trim().slice(command.length).trim()
  const workspace = useWorkspace.getState()
  const me = useSession.getState().me
  if (command === 'help') {
    print(' /help       명령 목록')
    print(' /projects   프로젝트 목록')
    print(' /create     프로젝트 생성')
    print(' /join ID    프로젝트 참여')
    print(' /open PATH  파일 열기')
    print(' /files      파일 목록')
    print(' /users      멤버와 접속자')
    print(' /invite [U] 멤버 초대 창 열기 (소유자)')
    print(' /who        채널 접속자')
    print(' /whoami     계정')
    print(' /nick NAME  이름 변경')
    print(' /msg U TEXT 개인 메시지')
    print(' /me ACTION  동작 메시지')
    print(' /settings   설정')
    print(' /leave      프로젝트 나가기')
    print(' /logout     로그아웃')
    print(' /clear      화면 지우기')
    return
  }
  if (command === 'clear') {
    useTerminal.getState().clear()
    return
  }
  if (command === 'whoami') {
    if (!me) return
    print(`${me.username}  ${me.email}`)
    print(`role ${workspace.project?.role ?? '—'}  system ${me.systemRole}`)
    return
  }
  if (command === 'projects') {
    await refreshProjects()
    const projects = useWorkspace.getState().projects
    for (const project of [...(projects?.owned ?? []), ...(projects?.participating ?? [])]) {
      print(`${project.name}  ${project.id}  ${project.role}  ${project.visibility}  members ${project.memberCount}`)
    }
    return
  }
  if (command === 'create') {
    useTerminal.getState().setMode('create-name')
    print('project name:')
    return
  }
  if (command === 'join') {
    if (!rest) { print('usage: /join [ID]', 'warn'); return }
    await openProject(rest.split(/\s+/)[0] ?? rest)
    print('joined', 'ok')
    return
  }
  if (command === 'invite') {
    if (!workspace.project) { print('open a project first', 'warn'); return }
    if (workspace.project.role !== 'OWNER') { print('only the project owner can invite', 'warn'); return }
    const preference = useSession.getState().preference
    if (preference?.panelLayout?.hideRight) {
      const next = await api<{ preference: Preference }>('/api/settings', { method: 'PATCH', body: JSON.stringify({ panelLayout: { ...preference.panelLayout, hideRight: false } }) })
      useSession.getState().patchPreference(next.preference)
    }
    workspace.setInvite({ name: rest.split(/\s+/)[0] ?? '' })
    print('invite panel opened →', 'ok')
    return
  }
  if (command === 'settings') {
    workspace.setView('settings')
    print('settings opened')
    return
  }
  if (command === 'logout') {
    await logout()
    location.assign('/')
    return
  }
  if (command === 'leave') {
    if (!workspace.project) { print('no project', 'warn'); return }
    await api(`/api/projects/${workspace.project.id}/leave`, { method: 'POST', body: '{}' })
    workspace.setProject(null)
    workspace.setView('dashboard')
    print('left project', 'ok')
    return
  }
  if (command === 'files') {
    const paths = filePathMap(workspace.files)
    for (const file of workspace.files) print(`${file.type === 'FOLDER' ? 'd' : '-'} ${paths.get(file.id)}`)
    return
  }
  if (command === 'open') {
    const paths = filePathMap(workspace.files)
    const match = workspace.files.find((file) => file.type === 'FILE' && (paths.get(file.id) === rest || file.name === rest))
    if (!match) { print('file not found', 'warn'); return }
    workspace.openTab({ id: match.id, name: match.name })
    print(`opened ${paths.get(match.id)}`, 'ok')
    return
  }
  if (command === 'users' || command === 'who') {
    const people = command === 'who' ? workspace.presence : workspace.members
    if (people.length === 0) print('(none)')
    for (const person of people) {
      const presence = workspace.presence.find((item) => item.userId === ('userId' in person ? person.userId : ''))
      print(`${person.username}  ${person.role ?? ''}  ${presence?.fileName ?? ''}`.trim())
    }
    return
  }
  if (command === 'nick') {
    await api('/api/profile', { method: 'PATCH', body: JSON.stringify({ username: rest }) })
    const next = await api<{ user: Me; preference: Preference }>('/api/auth/me')
    useSession.getState().setSession(next.user, next.preference)
    print(`nick ${next.user.username}`, 'ok')
    return
  }
  if (command === 'msg') {
    const [user, ...text] = rest.split(/\s+/)
    if (!user || text.length === 0) { print('usage: /msg [user] [text]', 'warn'); return }
    await api('/api/messages/direct', { method: 'POST', body: JSON.stringify({ username: user, content: text.join(' ') }) })
    print(`-> ${user}`, 'ok')
    return
  }
  if (command === 'me') {
    if (!workspace.project || !workspace.activeChannelId) { print('no channel', 'warn'); return }
    await api(`/api/projects/${workspace.project.id}/channels/${workspace.activeChannelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content: rest, kind: 'ACTION' }),
    })
    return
  }
  print('command not found', 'warn')
  void args
}
