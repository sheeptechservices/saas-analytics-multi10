'use client'
import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { CampoSenha } from '@/components/CampoSenha'

function ResetPasswordForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  // No celular fica só o formulário: o painel escuro some pelo CSS, já no HTML do servidor
  const leftPanel = (
    <div className="hidden md:flex" style={{
      background: 'var(--black)',
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
          Seu SDR aprimorado com<br /><span style={{ color: 'var(--primary)' }}>inteligência artificial</span>.
        </h1>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', lineHeight: 1.7, maxWidth: 340 }}>
          Gerencie seu ecossistema comercial automatizado em um só lugar.
        </p>
      </div>
      <div />
    </div>
  )

  if (!token) {
    return (
      <div className="grid min-h-dvh grid-cols-1 md:grid-cols-2">
        {leftPanel}
        <div className="px-5 py-8 md:p-12" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
          <div style={{ width: '100%', maxWidth: 380 }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.02em', marginBottom: 6 }}>
              Link inválido.
            </div>
            <p style={{ fontSize: 14, color: 'var(--gray)', marginBottom: 24 }}>
              O link de redefinição está incompleto ou foi mal formatado.
            </p>
            <a
              href="/forgot-password"
              style={{
                display: 'block', textAlign: 'center', padding: '13px',
                fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
                background: 'var(--primary)', color: 'var(--primary-contrast)',
                border: 'none', borderRadius: 100, textDecoration: 'none',
                transition: 'all .2s',
              }}
            >
              Solicitar novo link
            </a>
          </div>
        </div>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError('As senhas não coincidem.'); return }
    if (password.length < 8) { setError('A senha deve ter pelo menos 8 caracteres.'); return }
    setLoading(true)
    setError('')
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    })
    setLoading(false)
    if (res.ok) {
      setSuccess(true)
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Link inválido ou expirado.')
    }
  }

  return (
    <div className="grid min-h-dvh grid-cols-1 md:grid-cols-2">
      {leftPanel}
      <div className="px-5 py-8 md:p-12" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          {success ? (
            <div>
              <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.02em', marginBottom: 6 }}>
                Senha redefinida.
              </div>
              <div style={{
                padding: '16px', background: 'rgba(34,197,94,0.06)',
                border: '1px solid rgba(34,197,94,0.2)', borderRadius: 10,
                fontSize: 14, color: '#166534', lineHeight: 1.6, marginBottom: 24,
              }}>
                Senha redefinida com sucesso. Você já pode fazer login.
              </div>
              <a
                href="/login"
                style={{
                  display: 'block', textAlign: 'center', padding: '13px',
                  fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
                  background: 'var(--primary)', color: 'var(--primary-contrast)',
                  border: 'none', borderRadius: 100, textDecoration: 'none',
                  transition: 'all .2s',
                }}
              >
                Ir para o login
              </a>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.02em', marginBottom: 6 }}>
                Nova senha.
              </div>
              <p style={{ fontSize: 14, color: 'var(--gray)', marginBottom: 32 }}>
                Escolha uma senha com pelo menos 8 caracteres.
              </p>

              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)', letterSpacing: '0.04em' }}>
                    NOVA SENHA <span style={{ color: 'var(--red)', marginLeft: 2 }}>*</span>
                  </label>
                  <CampoSenha value={password} onChange={setPassword} required minLength={8} autoComplete="new-password" />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)', letterSpacing: '0.04em' }}>
                    CONFIRMAR SENHA <span style={{ color: 'var(--red)', marginLeft: 2 }}>*</span>
                  </label>
                  <CampoSenha value={confirm} onChange={setConfirm} required autoComplete="new-password" />
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
                  {loading ? 'Salvando…' : 'Redefinir senha'}
                </button>

                <div style={{ textAlign: 'center' }}>
                  <a
                    href="/forgot-password"
                    style={{ fontSize: 13, color: 'var(--gray)', textDecoration: 'none', fontWeight: 500 }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--primary)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--gray)')}
                  >
                    Solicitar novo link
                  </a>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  )
}
