export const THEMES = [
  { id: 'classic-green', label: 'Classic Green' },
  { id: 'cmd-classic', label: 'CMD Classic' },
  { id: 'amber', label: 'Amber Terminal' },
  { id: 'monochrome', label: 'Monochrome' },
  { id: 'vscode-blue', label: 'VS Code Blue' },
  { id: 'dracula', label: 'Dracula' },
  { id: 'monokai', label: 'Monokai' },
  { id: 'one-dark', label: 'One Dark' },
  { id: 'nord', label: 'Nord' },
  { id: 'solarized-dark', label: 'Solarized Dark' },
  { id: 'github-dark', label: 'GitHub Dark' },
  { id: 'cyberpunk', label: 'Cyberpunk' },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

export function isThemeId(value: string): value is ThemeId {
  return THEMES.some((theme) => theme.id === value)
}

export const LOCALES = [
  { id: 'en', label: 'English' },
  { id: 'ko', label: '한국어' },
] as const

export type LocaleId = (typeof LOCALES)[number]['id']

export function isLocaleId(value: string): value is LocaleId {
  return LOCALES.some((locale) => locale.id === value)
}
