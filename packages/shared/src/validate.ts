export function validateUsername(username: string): string | null {
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    return '사용자 이름은 3~20자의 영문, 숫자, 밑줄만 사용할 수 있습니다.'
  }
  return null
}

export function validateEmail(email: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return '이메일 형식이 올바르지 않습니다.'
  }
  return null
}

export function validatePassword(password: string, email: string, username: string): string | null {
  if (password.length < 10 || password.length > 128) return '비밀번호는 10자 이상 128자 이하여야 합니다.'
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return '비밀번호는 영문과 숫자를 포함해야 합니다.'
  const lower = password.toLowerCase()
  if (lower === email.toLowerCase() || lower === username.toLowerCase()) {
    return '비밀번호는 이메일이나 사용자 이름과 같을 수 없습니다.'
  }
  return null
}

export function validateProjectName(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed.length < 1 || trimmed.length > 80) return '프로젝트 이름은 1~80자여야 합니다.'
  if (/[\r\n\u0000]/.test(trimmed)) return '프로젝트 이름에 줄바꿈을 넣을 수 없습니다.'
  return null
}
