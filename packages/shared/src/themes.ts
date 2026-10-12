export const THEMES = [
  { id: 'classic-green', label: 'Classic Green' },
  { id: 'cmd-classic', label: 'CMD Classic' },
  { id: 'amber', label: 'Amber Terminal' },
  { id: 'monochrome', label: 'Monochrome' },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

export function isThemeId(value: string): value is ThemeId {
  return THEMES.some((theme) => theme.id === value)
}
