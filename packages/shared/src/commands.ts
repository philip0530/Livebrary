export const COMMANDS = [
  'help',
  'projects',
  'create',
  'join',
  'open',
  'files',
  'users',
  'whoami',
  'clear',
  'leave',
  'logout',
  'settings',
  'nick',
  'msg',
  'who',
  'me',
  'invite',
] as const

export type CommandName = (typeof COMMANDS)[number]

export type ParsedCommand = {
  name: string
  args: string[]
  rest: string
}

const HELP: Record<CommandName, string> = {
  help: '명령어 목록',
  projects: '프로젝트 목록',
  create: '프로젝트 생성 마법사',
  join: '프로젝트 참여  /join [ID]',
  open: '파일 열기  /open [path]',
  files: '파일 목록',
  users: '프로젝트 접속자와 멤버',
  whoami: '현재 계정',
  clear: '터미널 출력 지우기',
  leave: '프로젝트 멤버에서 나가기',
  logout: '로그아웃',
  settings: '설정 화면',
  nick: '사용자 이름 변경  /nick [name]',
  msg: '개인 메시지  /msg [user] [text]',
  who: '현재 채널 접속자',
  me: '동작 메시지  /me [action]',
  invite: '멤버 초대 창 열기  /invite [user]',
}

export function commandHelp(): string[] {
  return COMMANDS.map((name) => `/${name.padEnd(10, ' ')} ${HELP[name]}`)
}

export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null
  const body = trimmed.slice(1)
  const nameMatch = /^[a-z]+/i.exec(body)
  if (!nameMatch) return null
  const name = nameMatch[0].toLowerCase()
  const rest = body.slice(name.length).trim()
  if (name === 'msg') {
    const match = /^(\S+)\s+([\s\S]+)$/.exec(rest)
    if (!match) return { name, args: rest ? [rest] : [], rest }
    return { name, args: [match[1] ?? '', match[2] ?? ''], rest }
  }
  if (name === 'me' || name === 'nick' || name === 'open' || name === 'join') {
    return { name, args: rest ? [rest] : [], rest }
  }
  return { name, args: rest ? rest.split(/\s+/) : [], rest }
}

export function completeCommand(input: string, filePaths: string[] = []): string[] {
  if (!input.startsWith('/')) return []
  const body = input.slice(1)
  if (!body.includes(' ')) {
    return COMMANDS.filter((name) => name.startsWith(body.toLowerCase())).map((name) => `/${name}`)
  }
  const parsed = parseCommand(input)
  if (!parsed) return []
  if (parsed.name === 'open') {
    const prefix = parsed.rest.toLowerCase()
    return filePaths.filter((filePath) => filePath.toLowerCase().startsWith(prefix)).map((filePath) => `/open ${filePath}`)
  }
  return []
}
