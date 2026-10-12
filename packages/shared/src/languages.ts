const LANGUAGES: Record<string, string> = {
  html: 'html',
  css: 'css',
  js: 'javascript',
  ts: 'typescript',
  json: 'json',
  py: 'python',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  java: 'java',
  md: 'markdown',
  txt: 'plaintext',
}

export function languageFromName(name: string): string {
  const extension = name.includes('.') ? name.split('.').pop()?.toLowerCase() ?? '' : ''
  return LANGUAGES[extension] ?? 'plaintext'
}
