'use client'
import { useState } from 'react'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
    } catch {}
    setLoading(false)
    setSubmitted(true)
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
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.025) 1px,transparent 1px)',
          backgroundSize: '40px 40px',
        }} />

        <div />

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

      {/* Painel direito */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '48px', background: 'var(--bg)',
      }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.02em', marginBottom: 6 }}>
            Recuperar senha.
          </div>
          <p style={{ fontSize: 14, color: 'var(--gray)', marginBottom: 32 }}>
            Informe seu e-mail e enviaremos as instruções de redefinição.
          </p>

          {submitted ? (
            <div>
              <div style={{
                padding: '16px', background: 'rgba(34,197,94,0.06)',
                border: '1px solid rgba(34,197,94,0.2)', borderRadius: 10,
                fontSize: 14, color: '#166534', lineHeight: 1.6, marginBottom: 24,
              }}>
                Se este e-mail estiver cadastrado, você receberá as instruções em breve.
              </div>
              <a
                href="/login"
                style={{
                  display: 'block', textAlign: 'center',
                  fontSize: 13, color: 'var(--gray)', textDecoration: 'none', fontWeight: 500,
                }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--primary)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--gray)')}
              >
                ← Voltar ao login
              </a>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
                {loading ? 'Enviando…' : 'Enviar instruções'}
              </button>

              <div style={{ textAlign: 'center' }}>
                <a
                  href="/login"
                  style={{ fontSize: 13, color: 'var(--gray)', textDecoration: 'none', fontWeight: 500 }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--primary)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--gray)')}
                >
                  ← Voltar ao login
                </a>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
