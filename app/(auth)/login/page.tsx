'use client'
import { useState, useEffect } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { greeting } from '@/lib/utils'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [greet, setGreet] = useState('Bom dia')

  useEffect(() => { setGreet(greeting()) }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await signIn('credentials', { email, password, redirect: false })
    setLoading(false)
    if (res?.ok) {
      router.push('/dashboard')
    } else {
      setError('E-mail ou senha incorretos.')
    }
  }

  async function loginDemo(e: React.MouseEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await signIn('credentials', { email: 'admin@multi10.com', password: 'admin123', redirect: false })
    setLoading(false)
    if (res?.ok) router.push('/dashboard')
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: '100vh' }}>
      {/* Painel esquerdo escuro */}
      <div style={{
        background: 'var(--black)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '48px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Grid pattern */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.025) 1px,transparent 1px)',
          backgroundSize: '40px 40px',
        }} />

        <div />

        {/* Headline */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h1 style={{ fontSize: 34, fontWeight: 800, color: '#fff', lineHeight: 1.15, marginBottom: 14, letterSpacing: '-0.025em' }}>
            Funil de vendas<br /><span style={{ color: 'var(--primary)' }}>conectado</span><br />ao CRM.
          </h1>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', lineHeight: 1.7, maxWidth: 340 }}>
            Visualize métricas reais do seu Kommo, enriqueça seus leads e tome decisões com dados — tudo em um lugar.
          </p>
        </div>

        <div />
      </div>

      {/* Painel direito — formulário */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '48px', background: 'var(--bg)',
      }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.02em', marginBottom: 6 }}>
            {greet}.
          </div>
          <p style={{ fontSize: 14, color: 'var(--gray)', marginBottom: 32 }}>
            Entre com suas credenciais para acessar o painel.
          </p>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)', letterSpacing: '0.04em' }}>
                E-MAIL <span style={{ color: 'var(--red)', marginLeft: 2 }}>*</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com"
                required
                style={{
                  width: '100%', padding: '11px 14px',
                  fontFamily: 'inherit', fontSize: 14, fontWeight: 500,
                  color: 'var(--black)', background: 'var(--white)',
                  border: '1px solid var(--gray3)', borderRadius: 8, outline: 'none',
                  transition: 'border-color .2s, box-shadow .2s',
                }}
                onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 3px var(--primary-dim)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--gray3)'; e.target.style.boxShadow = 'none' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)', letterSpacing: '0.04em' }}>
                SENHA <span style={{ color: 'var(--red)', marginLeft: 2 }}>*</span>
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={{
                  width: '100%', padding: '11px 14px',
                  fontFamily: 'inherit', fontSize: 14, fontWeight: 500,
                  color: 'var(--black)', background: 'var(--white)',
                  border: '1px solid var(--gray3)', borderRadius: 8, outline: 'none',
                  transition: 'border-color .2s, box-shadow .2s',
                }}
                onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 3px var(--primary-dim)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--gray3)'; e.target.style.boxShadow = 'none' }}
              />
            </div>

            {error && (
              <div style={{
                padding: '10px 14px', background: 'rgba(217,48,37,0.06)',
                border: '1px solid rgba(217,48,37,0.2)', borderRadius: 8,
                fontSize: 13, fontWeight: 600, color: 'var(--red)',
              }}>{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', padding: '13px',
                fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
                background: loading ? 'var(--gray3)' : 'var(--primary)',
                color: loading ? 'var(--gray)' : 'var(--primary-contrast)', border: 'none', borderRadius: 100,
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all .2s',
              }}
            >
              {loading ? 'Entrando…' : 'Entrar'}
            </button>
          </form>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--gray3)' }} />
            <span style={{ fontSize: 12, color: 'var(--gray2)', fontWeight: 500 }}>ou acesse rapidamente</span>
            <div style={{ flex: 1, height: 1, background: 'var(--gray3)' }} />
          </div>

          <button
            onClick={loginDemo}
            disabled={loading}
            style={{
              width: '100%', padding: '11px',
              fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
              background: 'var(--white)', color: 'var(--black)',
              border: '1px solid var(--gray3)', borderRadius: 100,
              cursor: 'pointer', transition: 'all .2s',
            }}
            onMouseEnter={e => { (e.target as HTMLButtonElement).style.borderColor = 'var(--primary-mid)'; (e.target as HTMLButtonElement).style.background = 'var(--primary-dim)' }}
            onMouseLeave={e => { (e.target as HTMLButtonElement).style.borderColor = 'var(--gray3)'; (e.target as HTMLButtonElement).style.background = 'var(--white)' }}
          >
            Entrar como Admin (demo)
          </button>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '12px 14px', background: 'var(--white)',
            border: '1px solid var(--gray3)', borderRadius: 12, marginTop: 14,
          }}>
            <div style={{
              width: 28, height: 28, background: 'var(--primary-dim)',
              borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--primary-text)" strokeWidth="1.5">
                <rect x="3" y="7" width="10" height="7" rx="1.5"/>
                <path d="M5 7V5a3 3 0 0 1 6 0v2"/>
              </svg>
            </div>
            <div style={{ fontSize: 12, color: 'var(--gray)', lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--black)', fontWeight: 700, display: 'block' }}>Sem acesso?</strong>
              Solicite suas credenciais ao administrador da conta.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
