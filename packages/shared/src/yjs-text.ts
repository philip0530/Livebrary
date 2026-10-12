import * as Y from 'yjs'

export const YJS_TEXT_KEY = 'monaco'

export function encodeTextState(content: string): Uint8Array<ArrayBuffer> {
  const doc = new Y.Doc()
  if (content) doc.getText(YJS_TEXT_KEY).insert(0, content)
  const update = Y.encodeStateAsUpdate(doc)
  doc.destroy()
  const bytes = new ArrayBuffer(update.byteLength)
  new Uint8Array(bytes).set(update)
  return new Uint8Array(bytes)
}

export function decodeTextState(state: Uint8Array): string {
  const doc = new Y.Doc()
  if (state.byteLength > 0) Y.applyUpdate(doc, state)
  const text = doc.getText(YJS_TEXT_KEY).toString()
  doc.destroy()
  return text
}

export function asYDoc(document: unknown): Y.Doc {
  if (document instanceof Y.Doc) return document
  if (document && typeof document === 'object') {
    const record = document as { ydoc?: unknown; document?: unknown; getYDoc?: () => unknown }
    if (record.ydoc instanceof Y.Doc) return record.ydoc
    if (record.document instanceof Y.Doc) return record.document
    if (typeof record.getYDoc === 'function') {
      const value = record.getYDoc()
      if (value instanceof Y.Doc) return value
    }
  }
  throw new Error('Collaborative document is not available')
}
