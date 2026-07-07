import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, setAuth } from '../services/api'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isRegister, setIsRegister] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const fn = isRegister ? api.register : api.login
      const res = await fn(username, password)
      setAuth(res.token, res.user_id, res.username)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container" style={{ maxWidth: 400, paddingTop: '15vh' }}>
      <div className="panel">
        <h1 className="center">KENSHO</h1>
        <p className="center" style={{ color: 'var(--text-dim)', marginBottom: 24 }}>
          Entrenamiento neurocognitivo familiar
        </p>
        <form onSubmit={submit}>
          <input
            placeholder="Usuario"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <div className="error-msg">{error}</div>}
          <button type="submit" disabled={loading || !username || !password} style={{ width: '100%' }}>
            {isRegister ? 'Crear cuenta' : 'Entrar'}
          </button>
        </form>
        <p className="center mt">
          <a
            href="#"
            style={{ color: 'var(--accent)', fontSize: 14 }}
            onClick={(e) => { e.preventDefault(); setIsRegister(!isRegister) }}
          >
            {isRegister ? '¿Ya tienes cuenta? Entra' : '¿Nuevo? Crea tu cuenta'}
          </a>
        </p>
      </div>
    </div>
  )
}
