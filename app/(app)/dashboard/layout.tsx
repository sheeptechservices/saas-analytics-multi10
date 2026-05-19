'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'

const TABS = [
  { href: '/dashboard',            label: 'Visão Geral' },
  { href: '/dashboard/ranking',    label: 'Ranking' },
  { href: '/dashboard/marketing',  label: 'Marketing' },
  { href: '/dashboard/sdr-ia',     label: 'SDR IA' },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<'success' | 'error' | null>(null)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function fetchLastSync() {
    try {
      const res = await fetch('/api/kommo/sync')
      if (!res.ok) return
      const data = await res.json()
      setLastSyncAt(data.lastSyncAt ?? null)
    } catch {}
  }

  useEffect(() => {
    fetchLastSync()
  }, [])

  async function syncNow() {
    if (syncing) return
    setSyncing(true)
    setSyncResult(null)

    try {
      const res = await fetch('/api/kommo/sync?full=true', { method: 'POST' })

      if (!res.ok) {
        const err = await res.json().catch(() => null)
        console.error('[dashboard/sync] API error', res.status, err)
        setSyncing(false)
        showFeedback('error')
        return
      }

      if (!res.body) {
        setSyncing(false)
        showFeedback('error')
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let receivedFinal = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.stage === 'done') {
              setSyncing(false)
              receivedFinal = true
              showFeedback('success')
            } else if (data.stage === 'error') {
              console.error('[dashboard/sync] SSE error:', data.error)
              setSyncing(false)
              receivedFinal = true
              showFeedback('error')
            }
          } catch {}
        }
      }

      if (!receivedFinal) {
        setSyncing(false)
        showFeedback('error')
      }
    } catch {
      setSyncing(false)
      showFeedback('error')
    }

    fetchLastSync()
  }

  function showFeedback(result: 'success' | 'error') {
    setSyncResult(result)
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    feedbackTimer.current = setTimeout(() => setSyncResult(null), 4000)
  }

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
        marginBottom: 28, borderBottom: '1px solid var(--gray3)',
      }}>
        <div style={{ display: 'flex', gap: 0 }}>
          {TABS.map(tab => {
            const active = pathname === tab.href
            return (
              <Link
                key={tab.href}
                href={tab.href}
                style={{
                  padding: '8px 18px', fontSize: 13, fontWeight: 700,
                  color: active ? 'var(--black)' : 'var(--gray2)',
                  textDecoration: 'none',
                  borderBottom: `2px solid ${active ? 'var(--primary)' : 'transparent'}`,
                  marginBottom: -1,
                  transition: 'color .15s, border-color .15s',
                }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLAnchorElement).style.color = 'var(--gray)' }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLAnchorElement).style.color = 'var(--gray2)' }}
              >
                {tab.label}
              </Link>
            )
          })}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, paddingBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 600 }}>Última sincronização</span>
            <button
              onClick={syncNow}
              disabled={syncing}
              title="Sincronização incremental — busca apenas dados novos/alterados"
              style={{
                width: 26, height: 26, borderRadius: 8, border: '1px solid var(--gray3)',
                background: 'var(--bg)', cursor: syncing ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: syncing ? 0.4 : 1, transition: 'opacity .2s',
                flexShrink: 0,
              }}
            >
              <RefreshCw
                size={13}
                color={syncing ? 'var(--primary-text)' : 'var(--gray)'}
                style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }}
              />
            </button>
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--black)' }}>
            {lastSyncAt ? new Date(lastSyncAt).toLocaleString('pt-BR') : 'Nunca'}
          </div>
          {syncResult && (
            <div style={{ fontSize: 11, fontWeight: 600, color: syncResult === 'success' ? 'var(--green)' : 'var(--red)' }}>
              {syncResult === 'success' ? 'Sincronizado com sucesso' : 'Falha na sincronização'}
            </div>
          )}
        </div>
      </div>
      {children}
    </div>
  )
}
