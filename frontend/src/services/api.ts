const BASE = import.meta.env.VITE_API_URL || ''

export function getToken(): string | null {
  return localStorage.getItem('kensho_token')
}

export function setAuth(token: string, userId: string, username: string) {
  localStorage.setItem('kensho_token', token)
  localStorage.setItem('kensho_user_id', userId)
  localStorage.setItem('kensho_username', username)
}

export function clearAuth() {
  localStorage.removeItem('kensho_token')
  localStorage.removeItem('kensho_user_id')
  localStorage.removeItem('kensho_username')
}

export function getUsername(): string | null {
  return localStorage.getItem('kensho_username')
}

async function request(path: string, options: RequestInit = {}) {
  const token = getToken()
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  if (res.status === 401) {
    clearAuth()
    window.location.href = '/login'
    throw new Error('Sesión expirada')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `Error ${res.status}`)
  }
  return res.json()
}

export const api = {
  login: (username: string, password: string) =>
    request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  register: (username: string, password: string) =>
    request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }),
  startSession: (mode: string = 'competitive') =>
    request('/api/session/start', { method: 'POST', body: JSON.stringify({ mode }) }),
  endSession: (sessionId: string, difficultyEnd: number) =>
    request('/api/session/end', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, difficulty_end: difficultyEnd }),
    }),
  myHistory: () => request('/api/user/me/history'),
  rankings: () => request('/api/rankings'),
}
