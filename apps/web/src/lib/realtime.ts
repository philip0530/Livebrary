import { useEffect, useRef } from 'react'
import { useWorkspace, type ChatMessage, type PresenceUser } from '../stores'

type Handler = {
  onChat: (message: ChatMessage & { projectId?: string }) => void
  onPresence: (users: PresenceUser[]) => void
  onFiles: () => void
  onAccess: () => void
  onSystem: (text: string) => void
  onDm: (text: string) => void
}

let socket: WebSocket | null = null
let handlers: Handler | null = null
let projectId: string | null = null
let timer: number | null = null

export function setRealtimeHandler(next: Handler | null): void {
  handlers = next
}

export function subscribeProject(id: string | null): void {
  projectId = id
  if (socket?.readyState === WebSocket.OPEN && id) socket.send(JSON.stringify({ type: 'subscribe', projectId: id }))
}

export function focusFile(fileId: string | null): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'focus', fileId }))
}

export function connectRealtime(): void {
  if (socket && socket.readyState !== WebSocket.CLOSED) return
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  socket = new WebSocket(`${protocol}//${location.host}/ws`)
  socket.addEventListener('open', () => {
    useWorkspace.getState().setConnected(true)
    if (projectId) socket?.send(JSON.stringify({ type: 'subscribe', projectId }))
  })
  socket.addEventListener('close', () => {
    useWorkspace.getState().setConnected(false)
    socket = null
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(connectRealtime, 1500)
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as { type?: string; message?: ChatMessage & { projectId?: string; from?: string; to?: string; content?: string }; users?: PresenceUser[]; text?: string }
    if (message.type === 'chat' && message.message) handlers?.onChat(message.message)
    if (message.type === 'presence' && message.users) handlers?.onPresence(message.users)
    if (message.type === 'files') handlers?.onFiles()
    if (message.type === 'system' && message.text) handlers?.onSystem(message.text)
    if (message.type === 'dm' && message.message) handlers?.onDm(`DM ${message.message.from} -> ${message.message.to}: ${message.message.content}`)
    if (message.type === 'access') handlers?.onAccess()
  })
}

export function disconnectRealtime(): void {
  if (timer) window.clearTimeout(timer)
  timer = null
  projectId = null
  socket?.close()
  socket = null
}

export function useRealtime(): void {
  const onChat = useWorkspace((state) => state.addMessage)
  const setPresence = useWorkspace((state) => state.setPresence)
  const log = useWorkspace((state) => state.log)
  const activeChannel = useWorkspace((state) => state.activeChannelId)
  const channelRef = useRef(activeChannel)
  channelRef.current = activeChannel

  useEffect(() => {
    setRealtimeHandler({
      onChat: (message) => {
        if (message.channelId === channelRef.current) onChat(message)
      },
      onPresence: setPresence,
      onFiles: () => {
        log('file tree changed', 'ok')
        window.dispatchEvent(new Event('lb-files'))
      },
      onAccess: () => {
        log('access changed', 'warn')
        window.dispatchEvent(new Event('lb-access'))
      },
      onSystem: (text) => log(text, 'info'),
      onDm: (text) => log(text, 'ok'),
    })
    connectRealtime()
    return () => setRealtimeHandler(null)
  }, [log, onChat, setPresence])
}
