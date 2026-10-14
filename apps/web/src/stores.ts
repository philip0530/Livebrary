import { create } from 'zustand'
import type { LocaleId, ThemeId } from '@livebrary/shared'

export type Me = {
  id: string
  email: string
  username: string
  systemRole: 'USER' | 'SYSTEM_ADMIN'
  status: 'ACTIVE' | 'LIMITED'
  avatarUrl: string | null
  bio: string
  primaryLanguage: string
  createdAt: string
}

export type Preference = {
  theme: ThemeId | string
  fontSize: number
  lineNumbers: boolean
  wordWrap: boolean
  tabSize: number
  minimap: boolean
  crt: boolean
  notifications: boolean
  locale: LocaleId | string
  panelLayout: PanelLayout | null
}

export type PanelLayout = {
  left?: number
  right?: number
  bottom?: number
  chat?: number
  hideLeft?: boolean
  hideRight?: boolean
  hideBottom?: boolean
  hideChat?: boolean
}

export type ProjectSummary = {
  id: string
  name: string
  description: string
  visibility: 'PRIVATE' | 'PUBLIC'
  updatedAt: string
  role: 'OWNER' | 'EDITOR' | 'VIEWER'
  memberCount: number
  lastOpenedAt?: string | null
}

export type FileRecord = {
  id: string
  parentId: string | null
  name: string
  type: 'FILE' | 'FOLDER'
  language: string | null
  updatedAt: string
}

export type Channel = { id: string; name: string; unread: number }
export type ChatMessage = {
  id: string
  channelId: string
  username: string
  content: string
  kind: 'MESSAGE' | 'ACTION' | 'SYSTEM'
  createdAt: string
}
export type Member = { userId: string; username: string; role: string; avatarUrl?: string | null; primaryLanguage?: string }
export type PresenceUser = { userId: string; username: string; role: string | null; fileId: string | null; fileName: string | null }
export type SyncStatus = 'IDLE' | 'CONNECTING' | 'CONNECTED' | 'SYNCING' | 'SAVING' | 'SAVED' | 'OFFLINE' | 'ERROR'

type SessionState = {
  me: Me | null
  preference: Preference | null
  setSession: (me: Me, preference: Preference) => void
  patchPreference: (preference: Preference) => void
  clear: () => void
}

export const useSession = create<SessionState>((set) => ({
  me: null,
  preference: null,
  setSession: (me, preference) => set({ me, preference }),
  patchPreference: (preference) => set({ preference }),
  clear: () => set({ me: null, preference: null }),
}))

type WorkspaceState = {
  view: 'dashboard' | 'project' | 'settings' | 'versions' | 'project-settings'
  projects: { owned: ProjectSummary[]; participating: ProjectSummary[]; recent: ProjectSummary[] } | null
  invitations: { id: string; projectId: string; projectName: string; role: string; expiresAt: string | null }[]
  project: (ProjectSummary & { description: string; ownerId: string }) | null
  files: FileRecord[]
  channels: Channel[]
  activeChannelId: string | null
  messages: ChatMessage[]
  members: Member[]
  presence: PresenceUser[]
  tabs: { id: string; name: string }[]
  activeFileId: string | null
  logs: { id: number; text: string; tone: 'info' | 'ok' | 'warn' | 'error' }[]
  sync: SyncStatus
  connected: boolean
  setView: (view: WorkspaceState['view']) => void
  setProjects: (projects: WorkspaceState['projects']) => void
  setInvitations: (invitations: WorkspaceState['invitations']) => void
  setProject: (project: WorkspaceState['project']) => void
  setFiles: (files: FileRecord[]) => void
  setChannels: (channels: Channel[]) => void
  setActiveChannelId: (id: string | null) => void
  setMessages: (messages: ChatMessage[]) => void
  addMessage: (message: ChatMessage) => void
  setMembers: (members: Member[]) => void
  setPresence: (presence: PresenceUser[]) => void
  openTab: (file: { id: string; name: string }) => void
  closeTab: (id: string) => void
  setActiveFileId: (id: string | null) => void
  log: (text: string, tone?: 'info' | 'ok' | 'warn' | 'error') => void
  setSync: (sync: SyncStatus) => void
  setConnected: (connected: boolean) => void
  reset: () => void
}

let logId = 1
export const useWorkspace = create<WorkspaceState>((set) => ({
  view: 'dashboard',
  projects: null,
  invitations: [],
  project: null,
  files: [],
  channels: [],
  activeChannelId: null,
  messages: [],
  members: [],
  presence: [],
  tabs: [],
  activeFileId: null,
  logs: [],
  sync: 'IDLE',
  connected: false,
  setView: (view) => set({ view }),
  setProjects: (projects) => set({ projects }),
  setInvitations: (invitations) => set({ invitations }),
  setProject: (project) => set({ project }),
  setFiles: (files) => set({ files }),
  setChannels: (channels) => set({ channels }),
  setActiveChannelId: (activeChannelId) => set({ activeChannelId }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => state.messages.some((item) => item.id === message.id) ? state : { messages: [...state.messages, message] }),
  setMembers: (members) => set({ members }),
  setPresence: (presence) => set({ presence }),
  openTab: (file) => set((state) => ({
    tabs: state.tabs.some((tab) => tab.id === file.id) ? state.tabs.map((tab) => tab.id === file.id ? file : tab) : [...state.tabs, file],
    activeFileId: file.id,
    view: 'project',
  })),
  closeTab: (id) => set((state) => {
    const tabs = state.tabs.filter((tab) => tab.id !== id)
    return { tabs, activeFileId: state.activeFileId === id ? tabs.at(-1)?.id ?? null : state.activeFileId }
  }),
  setActiveFileId: (activeFileId) => set({ activeFileId }),
  log: (text, tone = 'info') => set((state) => ({ logs: [...state.logs.slice(-200), { id: logId++, text, tone }] })),
  setSync: (sync) => set({ sync }),
  setConnected: (connected) => set({ connected }),
  reset: () => set({
    view: 'dashboard', projects: null, invitations: [], project: null, files: [], channels: [],
    activeChannelId: null, messages: [], members: [], presence: [], tabs: [], activeFileId: null, logs: [], sync: 'IDLE', connected: false,
  }),
}))

export type TermLine = { id: number; text: string; tone: 'info' | 'ok' | 'warn' | 'error' }
type TerminalState = {
  lines: TermLine[]
  history: string[]
  mode: 'command' | 'create-name' | 'create-description' | 'create-visibility' | 'create-template'
  draft: { name: string; description: string; visibility: 'PRIVATE' | 'PUBLIC'; template: string }
  print: (text: string, tone?: TermLine['tone']) => void
  pushHistory: (line: string) => void
  setMode: (mode: TerminalState['mode']) => void
  setDraft: (draft: Partial<TerminalState['draft']>) => void
  clear: () => void
}
let termId = 1
export const useTerminal = create<TerminalState>((set) => ({
  lines: [{ id: 0, text: 'LIVEBRARY TERMINAL READY.  /help', tone: 'ok' }],
  history: [],
  mode: 'command',
  draft: { name: '', description: '', visibility: 'PRIVATE', template: 'empty' },
  print: (text, tone = 'info') => set((state) => ({ lines: [...state.lines.slice(-300), { id: termId++, text, tone }] })),
  pushHistory: (line) => set((state) => ({ history: [...state.history, line].slice(-100) })),
  setMode: (mode) => set({ mode }),
  setDraft: (draft) => set((state) => ({ draft: { ...state.draft, ...draft } })),
  clear: () => set({ lines: [], history: [], mode: 'command' }),
}))

export function applyTheme(preference: Preference | null): void {
  document.documentElement.dataset.theme = preference?.theme || 'classic-green'
  document.documentElement.dataset.crt = preference?.crt ? 'on' : 'off'
  document.documentElement.lang = preference?.locale === 'en' ? 'en' : 'ko'
}
