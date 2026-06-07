'use client'
import Link from 'next/link'
import { useState, useEffect, useCallback } from 'react'

interface SourceData {
  configured: boolean
  status?: string
  lastSyncAt?: number | null
  lastSyncStatus?: string | null
  lastSyncError?: string | null
  hasConfig?: boolean
  connMasked?: string
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'agora mesmo'
  if (mins < 60) return `há ${mins} min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `há ${hrs}h`
  const days = Math.floor(hrs / 24)
  return `há ${days} dia${days > 1 ? 's' : ''}`
}

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function SpinIcon() {
  return (
    <svg
      width="14" height="14" viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="2"
      style={{ animation: 'spin 1s linear infinite' }}
    >
      <path d="M1 4v5h5M15 12v-5h-5" />
      <path d="M13.4 7A6 6 0 1 0 12 12.3" />
    </svg>
  )
}

function SyncStatus({ data }: { data: SourceData }) {
  const s = data.lastSyncStatus

  if (!s) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--gray)' }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--gray3)', flexShrink: 0 }} />
        Aguardando primeira sincronização
      </div>
    )
  }

  if (s === 'running') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--primary-text)' }}>
        <SpinIcon />
        Sincronizando dados…
      </div>
    )
  }

  if (s === 'success') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>
        <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="var(--green)" strokeWidth="2">
          <path d="M2 6l3 3 5-5" />
        </svg>
        Última sincronização {data.lastSyncAt ? timeAgo(data.lastSyncAt) : '—'}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--red)' }}>
      <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="var(--red)" strokeWidth="2" style={{ marginTop: 1, flexShrink: 0 }}>
        <path d="M2 2l8 8M10 2L2 10" />
      </svg>
      <span>Erro na sincronização{data.lastSyncError ? `: ${data.lastSyncError}` : ''}</span>
    </div>
  )
}

export default function SdrSourcePage() {
  const [sourceData, setSourceData] = useState<SourceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [connStr, setConnStr] = useState('')
  const [showConn, setShowConn] = useState(false)
  const [testResult, setTestResult] = useState<{ valid: boolean; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  const fetchStatus = useCallback(() => {
    return fetch('/api/sdr/source')
      .then(r => r.json())
      .then((d: SourceData) => setSourceData(d))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchStatus().finally(() => setLoading(false))
  }, [fetchStatus])

  // Poll while sync is running
  useEffect(() => {
    if (sourceData?.lastSyncStatus !== 'running') return
    const id = setInterval(() => fetchStatus(), 3000)
    return () => clearInterval(id)
  }, [sourceData?.lastSyncStatus, fetchStatus])

  async function testConnection() {
    if (!connStr) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/sdr/source/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionString: connStr }),
      })
      const data = await res.json()
      setTestResult(data)
    } catch {
      setTestResult({ valid: false, error: 'Falha na conexão com o servidor' })
    } finally {
      setTesting(false)
    }
  }

  async function saveSource() {
    if (!connStr) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/sdr/source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionString: connStr }),
      })
      const data = await res.json()
      if (!data.ok) {
        setSaveError(data.error ?? 'Erro ao salvar')
        return
      }
      setConnStr('')
      setTestResult(null)
      setJustSaved(true)
      await fetchStatus()
    } catch {
      setSaveError('Erro de rede ao salvar')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return null

  const canTest = connStr.trim().length > 0 && !testing && !saving
  const canSave = connStr.trim().length > 0 && !saving

  return (
    <div>
      {/* Back link */}
      <Link
        href="/settings?tab=integracoes"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 13, fontWeight: 600, color: 'var(--gray)',
          textDecoration: 'none', marginBottom: 20,
        }}
      >
        ← Voltar para Integrações
      </Link>

      {/* Header */}
      <div className="animate-slide-up delay-1" style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.02em' }}>
          Fonte de Dados SDR
        </div>
        <div style={{ fontSize: 13, color: 'var(--gray)', marginTop: 2 }}>
          Conecte o banco Postgres do projeto 300 (Supabase) para sincronizar métricas, eventos e conversas
        </div>
      </div>

      {/* Status card — only when configured */}
      {sourceData?.configured && (
        <div
          className="animate-slide-up delay-2"
          style={{
            background: 'var(--white)', border: '1px solid var(--gray3)',
            borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 16,
            boxShadow: 'var(--shadow)',
          }}
        >
          <div style={{
            fontSize: 11, fontWeight: 800, textTransform: 'uppercase',
            letterSpacing: '0.08em', color: 'var(--gray2)',
            paddingBottom: 12, borderBottom: '1px solid var(--gray3)', marginBottom: 14,
          }}>
            Status da sincronização
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <SyncStatus data={sourceData} />
            {sourceData.connMasked && (
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray2)', fontFamily: 'monospace' }}>
                {sourceData.connMasked}
              </span>
            )}
          </div>

          {justSaved && sourceData.lastSyncStatus !== 'error' && (
            <div style={{
              marginTop: 12, padding: '10px 14px', borderRadius: 'var(--radius-sm)',
              background: 'rgba(30,138,62,0.06)', border: '1px solid rgba(30,138,62,0.2)',
              fontSize: 13, fontWeight: 600, color: '#145c2a',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="var(--green)" strokeWidth="2">
                <path d="M2 6l3 3 5-5" />
              </svg>
              Fonte salva — backfill iniciado em segundo plano
            </div>
          )}
        </div>
      )}

      {/* Config card */}
      <div
        className="animate-slide-up delay-3"
        style={{
          background: 'var(--white)', border: '1px solid var(--gray3)',
          borderRadius: 'var(--radius-lg)', padding: 24, boxShadow: 'var(--shadow)',
        }}
      >
        <div style={{
          fontSize: 11, fontWeight: 800, textTransform: 'uppercase',
          letterSpacing: '0.08em', color: 'var(--gray2)',
          paddingBottom: 14, borderBottom: '1px solid var(--gray3)', marginBottom: 20,
        }}>
          {sourceData?.configured ? 'Atualizar conexão' : 'Configurar fonte de dados'}
        </div>

        {/* Existing connection hint */}
        {sourceData?.configured && sourceData.connMasked && (
          <div style={{
            padding: '10px 14px', background: 'var(--bg)',
            border: '1px solid var(--gray3)', borderRadius: 'var(--radius-sm)',
            marginBottom: 16, fontSize: 13, fontWeight: 600, color: 'var(--gray)',
          }}>
            Conexão atual:{' '}
            <span style={{ fontFamily: 'monospace', color: 'var(--black)' }}>
              {sourceData.connMasked}
            </span>
            {' '}— insira uma nova para alterar
          </div>
        )}

        {/* Connection string field */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)', letterSpacing: '0.04em' }}>
            {sourceData?.configured ? 'NOVA CONNECTION STRING (POSTGRES)' : 'CONNECTION STRING (POSTGRES)'}
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type={showConn ? 'text' : 'password'}
              value={connStr}
              onChange={e => { setConnStr(e.target.value); setTestResult(null); setSaveError(null) }}
              placeholder="postgres://user:password@host:5432/database"
              style={{
                width: '100%', padding: '10px 44px 10px 14px',
                fontFamily: 'monospace', fontSize: 13, fontWeight: 500,
                color: 'var(--black)', background: 'var(--white)',
                border: '1px solid var(--gray3)', borderRadius: 'var(--radius-sm)',
                outline: 'none', boxSizing: 'border-box',
              }}
              onFocus={e => {
                e.target.style.borderColor = 'var(--primary)'
                e.target.style.boxShadow = '0 0 0 3px var(--primary-dim)'
              }}
              onBlur={e => {
                e.target.style.borderColor = 'var(--gray3)'
                e.target.style.boxShadow = 'none'
              }}
            />
            <button
              type="button"
              onClick={() => setShowConn(v => !v)}
              style={{
                position: 'absolute', right: 12, top: '50%',
                transform: 'translateY(-50%)', background: 'none',
                border: 'none', cursor: 'pointer', color: 'var(--gray2)', padding: 2,
              }}
            >
              <EyeIcon open={showConn} />
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--gray2)', fontWeight: 500 }}>
            Use uma role read-only. A connection string é armazenada criptografada.
          </div>
        </div>

        {/* Test result badge */}
        {testResult && (
          <div style={{
            marginBottom: 16, padding: '10px 14px', borderRadius: 'var(--radius-sm)',
            fontSize: 13, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 8,
            background: testResult.valid ? 'rgba(30,138,62,0.06)' : 'rgba(217,48,37,0.06)',
            border: `1px solid ${testResult.valid ? 'rgba(30,138,62,0.25)' : 'rgba(217,48,37,0.2)'}`,
            color: testResult.valid ? '#145c2a' : '#b02619',
          }}>
            {testResult.valid ? (
              <>
                <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="var(--green)" strokeWidth="2">
                  <path d="M2 6l3 3 5-5" />
                </svg>
                Conexão bem-sucedida — banco acessível
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="#b02619" strokeWidth="2">
                  <path d="M2 2l8 8M10 2L2 10" />
                </svg>
                {testResult.error ?? 'Falha na conexão'}
              </>
            )}
          </div>
        )}

        {/* Save error */}
        {saveError && (
          <div style={{
            marginBottom: 16, padding: '10px 14px', borderRadius: 'var(--radius-sm)',
            fontSize: 13, fontWeight: 600, color: '#b02619',
            background: 'rgba(217,48,37,0.06)', border: '1px solid rgba(217,48,37,0.2)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="#b02619" strokeWidth="2">
              <path d="M2 2l8 8M10 2L2 10" />
            </svg>
            {saveError}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={testConnection}
            disabled={!canTest}
            style={{
              padding: '10px 18px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
              background: 'var(--bg)', border: '1px solid var(--gray3)',
              borderRadius: 'var(--radius-pill)', cursor: canTest ? 'pointer' : 'not-allowed',
              color: 'var(--black)', opacity: !canTest ? 0.5 : 1,
              display: 'flex', alignItems: 'center', gap: 7,
            }}
          >
            {testing && <SpinIcon />}
            {testing ? 'Testando…' : 'Testar conexão'}
          </button>

          <button
            type="button"
            onClick={saveSource}
            disabled={!canSave}
            style={{
              padding: '10px 22px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
              background: 'var(--primary)', border: 'none',
              borderRadius: 'var(--radius-pill)', cursor: canSave ? 'pointer' : 'not-allowed',
              color: 'var(--primary-contrast)', opacity: !canSave ? 0.5 : 1,
              display: 'flex', alignItems: 'center', gap: 7,
            }}
          >
            {saving && <SpinIcon />}
            {saving ? 'Salvando…' : 'Salvar e conectar'}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg) }
          to   { transform: rotate(360deg) }
        }
      `}</style>
    </div>
  )
}
