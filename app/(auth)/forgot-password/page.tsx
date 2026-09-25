'use client'
import { useState } from 'react'

/* Frase escrita à mão, e não a que o servidor mandou no corpo.
 *
 * Esta tela é aberta a qualquer um, e a regra da casa (lib/api-error.ts) é que
 * corpo de erro não vira texto de tela sem um código que diga "isto foi escrito
 * para ser lido". Importar a constante de lib/ambiente.ts também não serve:
 * arrastaria o catálogo inteiro de variáveis de ambiente para o pacote do
 * navegador. Uma frase repetida é o menor dos três males. */
const FALHA_DE_ENVIO =
  'Não foi possível enviar o e-mail agora. O problema é do servidor, não do seu endereço. Tente de novo em instantes ou avise o suporte.'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [falhou, setFalhou] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    /* A tela dizia "você receberá as instruções em breve" acontecesse o que
     * acontecesse: a resposta era jogada fora. Quando o servidor recusa por
     * falta de configuração de e-mail, prometer o envio é mentira — a pessoa
     * espera por algo que nunca foi tentado.
     *
     * Ler o status aqui não denuncia se o e-mail existe: a rota decide a recusa
     * olhando só o ambiente, antes de tocar no banco, então ela é a mesma para
     * endereço cadastrado e não cadastrado. */
    let deuCerto = true
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      deuCerto = res.ok
    } catch {
      deuCerto = false
    }
    setLoading(false)
    setFalhou(!deuCerto)
    setSubmitted(true)
  }

  return (
    // No celular fica só o formulário: o painel escuro some pelo CSS, já no HTML do servidor
    <div className="grid min-h-dvh grid-cols-1 md:grid-cols-2">
      {/* Painel esquerdo escuro */}
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

      {/* Painel direito */}
      <div className="px-5 py-8 md:p-12" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg)',
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
              {/* Mesma caixa, duas caras. Um segundo elemento só para o erro
                  custaria mais um `style` em linha, e estilo em linha é dívida
                  que o lint conta uma a uma (eslint.config.mjs, MSG_STYLE). */}
              <div style={{
                padding: '16px',
                background: falhou ? 'rgba(217,48,37,0.06)' : 'rgba(34,197,94,0.06)',
                border: falhou ? '1px solid rgba(217,48,37,0.2)' : '1px solid rgba(34,197,94,0.2)',
                borderRadius: 10,
                fontSize: 14, color: falhou ? 'var(--red)' : '#166534', lineHeight: 1.6, marginBottom: 24,
              }}>
                {falhou ? FALHA_DE_ENVIO : 'Se este e-mail estiver cadastrado, você receberá as instruções em breve.'}
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
