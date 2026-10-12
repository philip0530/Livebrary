import net from 'node:net'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'

export function proxyUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, port: number): void {
  const target = net.connect({ port, host: '127.0.0.1' })
  const fail = () => {
    socket.destroy()
    target.destroy()
  }
  target.on('error', fail)
  socket.on('error', fail)
  target.on('connect', () => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const pathname = url.pathname.replace(/^\/collaboration/, '') || '/'
    const lines = [`GET ${pathname}${url.search} HTTP/1.1`]
    for (const [key, value] of Object.entries(request.headers)) {
      if (value == null) continue
      const values = Array.isArray(value) ? value : [value]
      for (const item of values) lines.push(`${key}: ${item}`)
    }
    target.write(`${lines.join('\r\n')}\r\n\r\n`)
    if (head.length > 0) target.write(head)
    target.pipe(socket)
    socket.pipe(target)
  })
}
