import { useEffect, useState } from 'react'
import Editor, { loader, type OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { IndexeddbPersistence } from 'y-indexeddb'
import { MonacoBinding } from 'y-monaco'
import * as Y from 'yjs'
import { documentName } from '@livebrary/shared'
import { focusFile } from '../lib/realtime'
import { useSession, useWorkspace } from '../stores'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  },
}

loader.config({ monaco })
monaco.editor.defineTheme('livebrary', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#1E1E1E',
    'editor.foreground': '#D4D4D4',
    'editorCursor.foreground': '#7BD88F',
    'editorLineNumber.foreground': '#7F8C7F',
  },
})

const COLORS = ['#7BD88F', '#6CC7E6', '#E6C07B', '#D48BD4', '#E68B8B', '#8BE0C2', '#C7D36C', '#8BB4E6']

function colorFor(id: string): string {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return COLORS[hash % COLORS.length] ?? '#7BD88F'
}

function safeColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#7BD88F'
}

type EditorHandle = Parameters<OnMount>[0]

export function EditorPane() {
  const project = useWorkspace((state) => state.project)
  const fileId = useWorkspace((state) => state.activeFileId)
  const files = useWorkspace((state) => state.files)
  const me = useSession((state) => state.me)
  const preference = useSession((state) => state.preference)
  const file = files.find((item) => item.id === fileId && item.type === 'FILE')
  const writable = project?.role === 'OWNER' || project?.role === 'EDITOR'
  const [editor, setEditor] = useState<EditorHandle | null>(null)

  useEffect(() => {
    if (!editor || !file || !project || !me) return
    const model = editor.getModel()
    if (!model) return
    let closed = false
    const ydoc = new Y.Doc()
    const name = documentName(project.id, file.id)
    const persistence = writable ? new IndexeddbPersistence(name, ydoc) : null
    if (!writable) void indexedDB.deleteDatabase(name)
    const provider = new HocuspocusProvider({
      url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collaboration`,
      name,
      document: ydoc,
      token: 'cookie',
    })
    const binding = new MonacoBinding(ydoc.getText('monaco'), model, new Set([editor]), provider.awareness)
    provider.awareness?.setLocalStateField('user', { name: me.username, color: colorFor(me.id) })
    const widgets = new Map<number, monaco.editor.IContentWidget>()
    const styles = new Set<string>()
    const renderCursors = () => {
      const states = provider.awareness?.getStates()
      const seen = new Set<number>()
      states?.forEach((state, clientId) => {
        if (clientId === ydoc.clientID) return
        const user = state.user as { name?: string; color?: string } | undefined
        const selection = state.selection as { head?: Y.RelativePosition } | undefined
        if (!selection?.head || !user?.name) return
        const abs = Y.createAbsolutePositionFromRelativePosition(selection.head, ydoc)
        if (!abs || abs.type !== ydoc.getText('monaco')) return
        const color = safeColor(user.color)
        const styleId = `lb-cursor-${clientId}`
        let style = document.getElementById(styleId)
        if (!style) {
          style = document.createElement('style')
          style.id = styleId
          document.head.appendChild(style)
        }
        styles.add(styleId)
        style.textContent = `.yRemoteSelection-${clientId}{background:${color}33}.yRemoteSelectionHead-${clientId}::after{border-left:2px solid ${color}}`
        let widget = widgets.get(clientId)
        if (!widget) {
          const node = document.createElement('div')
          node.className = 'remote-name'
          node.textContent = user.name
          node.style.cssText = `background:${color};color:#000;padding:0 4px;font-size:11px;`
          widget = {
            getId: () => `lb-name-${clientId}`,
            getDomNode: () => node,
            getPosition: () => null,
          }
          widgets.set(clientId, widget)
          editor.addContentWidget(widget)
        }
        widget.getDomNode().textContent = user.name
        const position = model.getPositionAt(abs.index)
        widget.getPosition = () => ({ position, preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE] })
        editor.layoutContentWidget(widget)
        seen.add(clientId)
      })
      for (const [clientId, widget] of widgets) {
        if (seen.has(clientId)) continue
        editor.removeContentWidget(widget)
        widgets.delete(clientId)
      }
    }
    provider.awareness?.on('change', renderCursors)
    const setSync = useWorkspace.getState().setSync
    provider.on('status', ({ status }: { status: string }) => {
      if (closed) return
      if (status === 'connecting') setSync('CONNECTING')
      if (status === 'connected') setSync('CONNECTED')
      if (status === 'disconnected') setSync('OFFLINE')
    })
    provider.on('stateless', ({ payload }: { payload: string }) => {
      if (closed) return
      if (payload === 'saving') setSync('SAVING')
      if (payload === 'saved') setSync('SAVED')
    })
    provider.on('authenticationFailed', () => {
      if (closed) return
      setSync('ERROR')
      void indexedDB.deleteDatabase(name)
      provider.destroy()
    })
    let syncTimer = 0
    const local = editor.onDidChangeModelContent((event) => {
      if (event.isFlush || !writable) return
      setSync('SYNCING')
      window.clearTimeout(syncTimer)
      syncTimer = window.setTimeout(() => {
        if (useWorkspace.getState().sync === 'SYNCING') setSync('CONNECTED')
      }, 1600)
    })
    focusFile(file.id)
    return () => {
      closed = true
      window.clearTimeout(syncTimer)
      local.dispose()
      provider.awareness?.off('change', renderCursors)
      for (const widget of widgets.values()) editor.removeContentWidget(widget)
      for (const styleId of styles) document.getElementById(styleId)?.remove()
      binding.destroy()
      provider.destroy()
      persistence?.destroy()
      ydoc.destroy()
      focusFile(null)
    }
  }, [editor, file?.id, me?.id, project?.id, writable])

  if (!file || !project) {
    return (
      <div className="editor-empty">
        <pre>{'┌──────────────────────┐\n│   no file is open    │\n└──────────────────────┘'}</pre>
        <span>pick a file on the left, or type <span className="accent">/open [path]</span></span>
      </div>
    )
  }
  return (
    <div className="editor-wrap">
      <Editor
        key={file.id}
        theme="livebrary"
        language={file.language ?? 'plaintext'}
        path={file.id}
        onMount={(next) => setEditor(next)}
        options={{
          fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
          fontSize: preference?.fontSize ?? 14,
          lineNumbers: preference?.lineNumbers === false ? 'off' : 'on',
          wordWrap: preference?.wordWrap ? 'on' : 'off',
          tabSize: preference?.tabSize ?? 2,
          minimap: { enabled: preference?.minimap !== false },
          readOnly: !writable,
          automaticLayout: true,
          scrollBeyondLastLine: false,
        }}
      />
    </div>
  )
}
