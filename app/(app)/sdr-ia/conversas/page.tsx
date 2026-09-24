'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import type { CSSProperties } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { BREAKPOINTS } from '@/lib/hooks/useMediaQuery'
import { Skeleton, SkeletonSessionList } from '@/components/Skeleton'
import { useEndpointAllowed } from '@/components/ModulesProvider'
import { ApiErrorState } from '@/components/ApiErrorState'
import { fetchJson, textoDaFalha, textoDeModuloDesligado } from '@/lib/api-error'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionItem {
  sessionId:   string
  name:        string | null
  phone:       string
  lastContact: number | null
  msgs:        number
  lastMessage: { content: string; role: string }
}

interface Message {
  id:         string
  role:       'human' | 'ai' | 'system'
  content:    string
  occurredAt: number | null
  metadata:   Record<string, unknown>
  origin?:    'ycloud' | 'n8n'
}

interface Thread {
  sessionId:      string
  contact:        { name: string | null; phone: string }
  inWindow:       boolean
  windowExpiresAt: number | null
  messages:       Message[]
}

interface WaTemplate {
  name:       string
  language:   string
  category?:  string
  status:     string
  components?: unknown[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function countVars(tpl: WaTemplate): number {
  if (!tpl.components) return 0
  const body = (tpl.components as Array<Record<string, unknown>>)
    .find(c => String(c.type).toUpperCase() === 'BODY')
  if (!body || typeof body.text !== 'string') return 0
  return (body.text.match(/\{\{\d+\}\}/g) ?? []).length
}

function buildComponents(values: string[]): object[] {
  if (!values.length) return []
  return [{ type: 'body', parameters: values.map(text => ({ type: 'text', text })) }]
}

// ?session=<id> deep link. supabase-n8n sessionIds arrive as plain digits (no '+') — normalize to E.164.
function sessionFromParam(raw: string | null): string | null {
  if (!raw) return null
  return raw.startsWith('+') ? raw : '+' + raw
}

// Below lg the list and the thread take turns (master-detail) — the same cut as
// the max-lg: classes of the layout. Read at the moment of a tap: it decides
// behavior (history), not layout.
function listAndThreadTakeTurns(): boolean {
  return window.matchMedia(`(max-width: ${BREAKPOINTS.tablet - 1}px)`).matches
}

// History entry pushed when a tap on the list opens a thread (below lg): it
// names the conversation it shows, so Back/Forward know what to close or reopen.
interface ConvHistoryState { convSession?: unknown }

const LS_KEY = 'sdr-conversas-lidas'

function readLidas(): Record<string, number> {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as Record<string, number>) : {}
  } catch { return {} }
}

function saveLidas(map: Record<string, number>): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)) } catch {}
}

// Returns YYYY-MM-DD in America/Sao_Paulo — used as a stable day key for grouping
function dayKey(ts: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(ts))
}

// Returns a human-readable pt-BR label for a YYYY-MM-DD key (in Sao Paulo local day)
function dayLabel(key: string): string {
  const toKey = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)
  const nowKey = toKey(new Date())
  if (key === nowKey) return 'Hoje'
  // Build yesterday's key from noon BRT today to avoid DST edge cases
  const [ny, nm, nd] = nowKey.split('-').map(Number)
  const noonTodayUTC = new Date(Date.UTC(ny, nm - 1, nd, 15, 0, 0)) // 15:00 UTC = 12:00 BRT
  const yestKey = toKey(new Date(noonTodayUTC.getTime() - 24 * 3_600_000))
  if (key === yestKey) return 'Ontem'
  const [y, m, d] = key.split('-').map(Number)
  return new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo',
  }).format(new Date(Date.UTC(y, m - 1, d, 15, 0, 0)))
}

function pagerStyle(enabled: boolean): CSSProperties {
  return {
    fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 'var(--radius-pill)',
    border: '1px solid var(--gray3)', background: 'transparent',
    cursor: enabled ? 'pointer' : 'not-allowed',
    color: enabled ? 'var(--black)' : 'var(--gray3)',
    fontFamily: 'inherit',
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Bubble({ msg }: { msg: Message }) {
  const isHuman  = msg.role === 'human'
  const isN8nBot = !isHuman && msg.origin === 'n8n'
  return (
    <div style={{ display: 'flex', justifyContent: isHuman ? 'flex-start' : 'flex-end' }}>
      {/* 72% of the pane; on a phone the pane is narrow, so the bubble may take 85% */}
      <div className="max-w-[85%] md:max-w-[72%]" style={{
        padding: '8px 12px', wordBreak: 'break-word',
        borderRadius: isHuman ? 'var(--radius-xs) var(--radius-md) var(--radius-md) var(--radius-md)' : 'var(--radius-md) var(--radius-xs) var(--radius-md) var(--radius-md)',
        background: isHuman ? 'var(--bg)' : 'var(--primary)',
        border: isHuman ? '1px solid var(--gray3)' : 'none',
        color: isHuman ? 'var(--black)' : 'var(--primary-contrast)',
        fontSize: 13, lineHeight: 1.5,
      }}>
        <div style={{ marginBottom: 3 }}>{msg.content}</div>
        <div style={{
          fontSize: 10, opacity: 0.55, textAlign: isHuman ? 'left' : 'right',
          display: 'flex', alignItems: 'center', gap: 4,
          justifyContent: isHuman ? 'flex-start' : 'flex-end',
        }}>
          {isN8nBot && (
            <span style={{
              fontSize: 'var(--text-2xs)', fontWeight: 800, padding: '1px 5px', borderRadius: 'var(--radius-xs)',
              background: 'rgba(255,255,255,0.22)', letterSpacing: '0.05em',
            }}>IA</span>
          )}
          {timeAgo(msg.occurredAt)}
        </div>
      </div>
    </div>
  )
}

function DateSeparator({ label }: { label: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      margin: '6px 0',
    }}>
      <span style={{
        fontSize: 11, fontWeight: 600, color: 'var(--gray2)',
        background: 'rgba(0,0,0,0.05)', padding: '3px 12px', borderRadius: 'var(--radius-pill)',
        letterSpacing: '0.02em', userSelect: 'none',
      }}>
        {label}
      </span>
    </div>
  )
}

interface SendBtnProps { label: string; disabled: boolean; loading: boolean; onClick: () => void }
function SendBtn({ label, disabled, loading, onClick }: SendBtnProps) {
  return (
    <button onClick={onClick} disabled={disabled} className="max-md:min-h-10" style={{
      padding: '9px 20px', borderRadius: 'var(--radius-md)', border: 'none',
      fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
      cursor: disabled ? 'not-allowed' : 'pointer', flexShrink: 0,
      background: disabled ? 'var(--gray3)' : 'var(--primary)',
      color: disabled ? 'var(--gray2)' : 'var(--primary-contrast)',
      transition: 'background .15s',
    }}>
      {loading ? 'Enviando...' : label}
    </button>
  )
}

interface TplComposerProps {
  templates:       WaTemplate[] | null
  loading:         boolean
  selected:        WaTemplate | null
  vars:            string[]
  windowExpiresAt: number | null
  sending:         boolean
  onSelect:        (tpl: WaTemplate) => void
  onVarChange:     (i: number, v: string) => void
  onSend:          () => void
}
function TemplateComposer({
  templates, loading, selected, vars, windowExpiresAt, sending, onSelect, onVarChange, onSend,
}: TplComposerProps) {
  const expiredAgo = windowExpiresAt ? timeAgo(windowExpiresAt) : null
  return (
    <div>
      <div style={{
        marginBottom: 10, padding: '8px 12px', borderRadius: 'var(--radius-sm)', fontSize: 12, fontWeight: 600,
        background: 'rgba(217,150,0,0.06)', border: '1px solid rgba(217,150,0,0.25)', color: 'var(--warn-text)',
      }}>
        {expiredAgo
          ? `Janela de 24h expirada há ${expiredAgo} — envie um template aprovado`
          : 'Nenhuma mensagem recebida ainda — inicie com um template aprovado'}
      </div>

      {loading && (
        <p style={{ fontSize: 12, color: 'var(--gray2)', margin: 0 }}>Carregando templates...</p>
      )}

      {!loading && templates !== null && (
        templates.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--gray2)', margin: 0 }}>
            Nenhum template aprovado disponível nesta conta.
          </p>
        ) : (
          <>
            <select
              value={selected?.name ?? ''}
              onChange={e => {
                const t = templates.find(x => x.name === e.target.value)
                if (t) onSelect(t)
              }}
              style={{
                width: '100%', fontFamily: 'inherit', fontSize: 13,
                padding: '8px 12px', marginBottom: 8,
                border: '1px solid var(--gray3)', borderRadius: 'var(--radius-sm)',
                background: 'var(--bg)', color: 'var(--black)',
              }}
            >
              <option value="">Selecionar template...</option>
              {templates.map(t => (
                <option key={`${t.name}:${t.language}`} value={t.name}>
                  {t.name} ({t.language}){t.category ? ` · ${t.category}` : ''}
                </option>
              ))}
            </select>

            {selected && vars.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                {vars.map((v, i) => (
                  <input
                    key={i}
                    value={v}
                    onChange={e => onVarChange(i, e.target.value)}
                    placeholder={`Variável {{${i + 1}}}`}
                    style={{
                      fontFamily: 'inherit', fontSize: 13, padding: '7px 12px',
                      border: '1px solid var(--gray3)', borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg)', color: 'var(--black)',
                    }}
                  />
                ))}
              </div>
            )}

            {selected && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <SendBtn
                  label="Enviar template"
                  disabled={sending || vars.some(v => !v.trim())}
                  loading={sending}
                  onClick={onSend}
                />
              </div>
            )}
          </>
        )
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const SESSION_LIMIT = 20

export default function ConversasPage() {
  const searchParams = useSearchParams()

  // Session list
  const [sessions,    setSessions]    = useState<SessionItem[]>([])
  const [sessTotal,   setSessTotal]   = useState(0)
  const [sessPage,    setSessPage]    = useState(1)
  const [sessLoading, setSessLoading] = useState(true)
  // Tudo nesta tela — inclusive /api/sdr/sync — é liberado pela mesma chave
  // (integration.ycloud-whatsapp), a mesma da rota. Gating aqui é defesa em
  // profundidade: o layout de (app) não é refeito na navegação do cliente.
  const { permitido, moduleKey } = useEndpointAllowed('/api/ycloud/conversations')
  // O erro em si, não um booleano: 403 e 500 saem com frases diferentes.
  const [sessError,   setSessError]   = useState<unknown>(null)
  const [threadError, setThreadError] = useState<unknown>(null)
  const [tplError,    setTplError]    = useState<unknown>(null)

  // Active thread. A ?session= deep link starts selected (and loading) already in
  // the server HTML: below lg the list and the thread take turns, and a phone must
  // not paint the list before the conversation it asked for. The fetch itself
  // still comes from the deep-link effect below.
  const [activeId,      setActiveId]      = useState<string | null>(() => sessionFromParam(searchParams.get('session')))
  const [thread,        setThread]        = useState<Thread | null>(null)
  const [threadLoading, setThreadLoading] = useState(() => sessionFromParam(searchParams.get('session')) !== null)

  // Templates — per-tenant, cached across threads
  const [templates,  setTemplates]  = useState<WaTemplate[] | null>(null)
  const [tplLoading, setTplLoading] = useState(false)
  const [tplLoaded,  setTplLoaded]  = useState(false)

  // Composer
  const [textBody,    setTextBody]    = useState('')
  const [selTemplate, setSelTemplate] = useState<WaTemplate | null>(null)
  const [tplVars,     setTplVars]     = useState<string[]>([])
  const [sending,     setSending]     = useState(false)
  const [sendError,   setSendError]   = useState<string | null>(null)

  // Sync on demand
  const [syncing,      setSyncing]      = useState(false)
  const [syncFeedback, setSyncFeedback] = useState<'success' | 'error' | null>(null)
  const [syncEpoch,    setSyncEpoch]    = useState(0)

  // Search
  const [searchRaw, setSearchRaw] = useState('')
  const [search,    setSearch]    = useState('')

  // Unread tracking (localStorage-backed)
  const [lidas, setLidas] = useState<Record<string, number>>({})

  const bottomRef     = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  // Stale-fetch guard: ensures a slow earlier fetch can't overwrite a later thread
  const fetchIdRef    = useRef(0)
  // Refs mirroring state so the polling interval (empty deps) always sees fresh values
  const activeIdRef   = useRef<string | null>(null)
  const sessPageRef   = useRef(1)
  // Auto-scroll helpers: count tracks message growth; flag requests a guaranteed scroll
  const prevMsgCountRef         = useRef(0)
  const scrollToBottomOnLoadRef = useRef(false)
  const lidasRef                = useRef<Record<string, number>>({})
  const didMountSyncRef         = useRef(false)
  const permitidoRef            = useRef(false)
  const didDeepLinkRef          = useRef(false)
  // Master-detail focus (below lg): a tap on the list sends focus to the back
  // button of the thread that replaces it; the back button returns it to the row.
  const backBtnRef       = useRef<HTMLButtonElement>(null)
  const searchInputRef   = useRef<HTMLInputElement>(null)
  const focusBackRef     = useRef(false)
  const returnFocusIdRef = useRef<string | null>(null)

  // ── Fetch session list ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!permitido) { setSessLoading(false); return }
    setSessLoading(true)
    setSessError(null)
    fetchJson<{ items: SessionItem[]; total: number }>(`/api/ycloud/conversations?page=${sessPage}&limit=${SESSION_LIMIT}`)
      .then((d: { items: SessionItem[]; total: number }) => {
        setSessions(d.items)
        setSessTotal(d.total)
      })
      .catch((e: unknown) => setSessError(e))
      .finally(() => setSessLoading(false))
  }, [sessPage, syncEpoch, permitido])

  // ── Smart auto-scroll ───────────────────────────────────────────────────────
  // When a conversation is opened/switched, loadThread() sets scrollToBottomOnLoadRef
  // so we scroll unconditionally on the first render. For subsequent updates (poll,
  // optimistic sends) we only scroll if new messages arrived AND the user is near bottom.
  useEffect(() => {
    if (!thread) return
    const newCount = thread.messages.length

    if (scrollToBottomOnLoadRef.current) {
      scrollToBottomOnLoadRef.current = false
      prevMsgCountRef.current = newCount
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      return
    }

    const prevCount = prevMsgCountRef.current
    prevMsgCountRef.current = newCount
    if (newCount > prevCount) {
      const el = scrollAreaRef.current
      const nearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120
      if (nearBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      // Polling brought new messages while this conversation is open → stay marked as read
      if (activeId) {
        const now = Date.now()
        const next = { ...lidasRef.current, [activeId]: now }
        lidasRef.current = next
        setLidas(next)
        saveLidas(next)
      }
    }
  }, [thread, activeId])

  // ── Lazy-load templates when window is closed ───────────────────────────────
  useEffect(() => {
    if (thread && !thread.inWindow && !tplLoaded && !tplLoading) {
      setTplLoading(true)
      setTplError(null)
      fetchJson<{ templates: WaTemplate[] }>('/api/ycloud/templates')
        .then((d: { templates: WaTemplate[] }) =>
          setTemplates(d.templates.filter(t => t.status === 'approved'))
        )
        // Antes a falha virava lista vazia, indistinguível de "a conta não tem
        // template aprovado". Agora o compositor diz o que aconteceu.
        .catch((e: unknown) => { setTemplates([]); setTplError(e) })
        .finally(() => { setTplLoading(false); setTplLoaded(true) })
    }
  }, [thread, tplLoaded, tplLoading])

  // Keep refs in sync with state so the polling interval (empty deps) reads fresh values
  useEffect(() => { permitidoRef.current = permitido }, [permitido])
  useEffect(() => { activeIdRef.current = activeId }, [activeId])
  useEffect(() => { sessPageRef.current = sessPage }, [sessPage])

  // Hydrate lidas from localStorage on mount (client-only)
  useEffect(() => {
    const stored = readLidas()
    lidasRef.current = stored
    setLidas(stored)
  }, [])

  // Deep-link: open ?session=<id> on mount (once, StrictMode-safe via ref guard)
  useEffect(() => {
    if (didDeepLinkRef.current) return
    const sessionId = sessionFromParam(searchParams.get('session'))
    if (!sessionId) return
    didDeepLinkRef.current = true
    loadThread(sessionId)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // Master-detail focus. Only moves focus when the list and the thread take turns
  // (below lg, where the back button is rendered); side by side it stays put.
  useEffect(() => {
    if (activeId) {
      if (!focusBackRef.current) return
      focusBackRef.current = false
      const btn = backBtnRef.current
      if (btn && btn.getClientRects().length > 0) btn.focus()
    } else if (returnFocusIdRef.current) {
      const id = returnFocusIdRef.current
      returnFocusIdRef.current = null
      const row = document.querySelector<HTMLElement>(`[data-session-id="${CSS.escape(id)}"]`)
      ;(row ?? searchInputRef.current)?.focus()
    }
  }, [activeId])

  // Back/Forward through the entries openFromList pushes (below lg): the entry
  // says which conversation it shows — none means the list. Reads live state
  // through refs (registered once). Leaving the page is the router's business.
  useEffect(() => {
    const pathname = window.location.pathname
    function onPopState(e: PopStateEvent) {
      if (window.location.pathname !== pathname) return
      const entry = e.state as ConvHistoryState | null
      const sessionId = typeof entry?.convSession === 'string'
        ? entry.convSession
        : sessionFromParam(new URLSearchParams(window.location.search).get('session'))
      if (sessionId) {
        // Forward reopening a thread sends focus to its back button, as a tap
        // on the list does (the focus effect only moves it where that button
        // is rendered, below lg)
        if (sessionId !== activeIdRef.current) {
          focusBackRef.current = true
          loadThread(sessionId)
        }
      } else if (activeIdRef.current) {
        clearThread()
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // Auto-sync once on mount so conversations are fresh when the page opens
  useEffect(() => {
    if (didMountSyncRef.current) return
    didMountSyncRef.current = true
    void syncNow()
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce search input — avoids filtering on every keystroke
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchRaw.trim().toLowerCase()), 250)
    return () => clearTimeout(t)
  }, [searchRaw])

  // ── Background polling every 15 s ───────────────────────────────────────────
  // Silently refreshes the session list and the open thread without touching loading state.
  // Pauses while the tab is hidden; catches up immediately on return.
  useEffect(() => {
    function pollOnce() {
      if (document.hidden) return
      if (!permitidoRef.current) return

      // Refresh session list — no setSessLoading, so no spinner
      fetchJson<{ items: SessionItem[]; total: number }>(`/api/ycloud/conversations?page=${sessPageRef.current}&limit=${SESSION_LIMIT}`)
        .then((d: { items: SessionItem[]; total: number }) => {
          setSessions(d.items)
          setSessTotal(d.total)
        })
        // O poll é silencioso de propósito: o que está na tela continua válido,
        // e a falha aparece na próxima leitura com estado de carregamento.
        .catch(() => {})

      // Refresh active thread — guard against stale response with captured id check
      const currentId = activeIdRef.current
      if (currentId) {
        fetchJson<Thread>(`/api/ycloud/conversations/${encodeURIComponent(currentId)}`)
          .then((d: Thread) => {
            if (activeIdRef.current !== currentId) return
            setThread(d)
            // O poll que dá certo apaga o erro da tentativa anterior. Sem isto, a
            // faixa vermelha ficava pendurada acima das mensagens já carregadas,
            // dizendo que a conversa não abriu enquanto ela estava ali na tela.
            setThreadError(null)
          })
          .catch(() => {})
      }
    }

    const timerId = setInterval(pollOnce, 15_000)

    function onVisibilityChange() { if (!document.hidden) pollOnce() }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      clearInterval(timerId)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])  // intentionally empty — reads live state through refs

  // ── Sync on demand ──────────────────────────────────────────────────────────
  async function syncNow() {
    // /api/sdr/sync pede a mesma chave desta tela, mas a checagem fica explícita
    // para o botão nunca disparar uma requisição que só voltaria 403.
    if (syncing || !permitido) return
    setSyncing(true)
    setSyncFeedback(null)
    try {
      const res = await fetch('/api/sdr/sync', { method: 'POST' })
      if (!res.ok) throw new Error()
      setSyncFeedback('success')
      setSyncEpoch(e => e + 1)
    } catch {
      setSyncFeedback('error')
    } finally {
      setSyncing(false)
      setTimeout(() => setSyncFeedback(null), 3000)
    }
  }

  // ── Open a session ──────────────────────────────────────────────────────────
  function loadThread(sessionId: string) {
    const fetchId = ++fetchIdRef.current
    setActiveId(sessionId)
    activeIdRef.current         = sessionId  // sync immediately (no state-update lag for poll guard)
    scrollToBottomOnLoadRef.current = true   // guarantee scroll when thread arrives
    // Mark conversation as read immediately on open
    const _now  = Date.now()
    const _next = { ...lidasRef.current, [sessionId]: _now }
    lidasRef.current = _next
    setLidas(_next)
    saveLidas(_next)
    setThread(null)
    setThreadLoading(true)
    setThreadError(null)
    setSendError(null)
    setTextBody('')
    setSelTemplate(null)
    setTplVars([])
    fetchJson<Thread>(`/api/ycloud/conversations/${encodeURIComponent(sessionId)}`)
      .then((d: Thread) => { if (fetchIdRef.current === fetchId) setThread(d) })
      // Sem isto a conversa abria num painel em branco, sem dizer por quê.
      .catch((e: unknown) => { if (fetchIdRef.current === fetchId) setThreadError(e) })
      .finally(() => { if (fetchIdRef.current === fetchId) setThreadLoading(false) })
  }

  // ── Open from the list ──────────────────────────────────────────────────────
  // Below lg the thread replaces the list, and the tap pushes ?session=<id> as a
  // history entry of its own: the device Back button then closes the thread
  // (popstate effect above) instead of leaving Conversas — and taking the draft
  // with it. Side by side (from lg) the URL stays as it is.
  function openFromList(sessionId: string) {
    focusBackRef.current = true
    loadThread(sessionId)
    if (!listAndThreadTakeTurns()) return
    const url = new URL(window.location.href)
    url.searchParams.set('session', sessionId)
    const entry: ConvHistoryState = { convSession: sessionId }
    window.history.pushState(entry, '', url.pathname + url.search + url.hash)
  }

  // Clears the selection the way loadThread switches it.
  function clearThread() {
    returnFocusIdRef.current = activeIdRef.current
    fetchIdRef.current++                    // a thread fetch still in flight must not land
    setActiveId(null)
    activeIdRef.current = null
    setThread(null)
    setThreadLoading(false)
    setSendError(null)
    setTextBody('')
    setSelTemplate(null)
    setTplVars([])
  }

  // ── Back to the list (master-detail, below lg) ──────────────────────────────
  // A thread opened from the list steps back through history, so Back and
  // Forward stay in step with the screen (popstate does the clearing). One that
  // came in by the ?session= link has no entry of its own: clear it here and
  // drop ?session= from the URL, so a reload doesn't reopen the conversation.
  function closeThread() {
    if (activeId && (window.history.state as ConvHistoryState | null)?.convSession === activeId) {
      window.history.back()
      return
    }
    clearThread()
    const url = new URL(window.location.href)
    if (url.searchParams.has('session')) {
      url.searchParams.delete('session')
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    }
  }

  // ── Send ────────────────────────────────────────────────────────────────────
  async function send() {
    if (!activeId || !thread || sending) return
    setSendError(null)

    let reqBody: object
    let preview: string

    if (thread.inWindow) {
      if (!textBody.trim()) return
      reqBody = { to: activeId, type: 'text', body: textBody.trim() }
      preview = textBody.trim()
    } else {
      if (!selTemplate || tplVars.some(v => !v.trim())) return
      reqBody = {
        to:           activeId,
        type:         'template',
        templateName: selTemplate.name,
        languageCode: selTemplate.language,
        components:   buildComponents(tplVars.map(v => v.trim())),
      }
      preview = `[template:${selTemplate.name}]`
    }

    setSending(true)
    try {
      const res  = await fetch('/api/ycloud/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody),
      })
      const data = await res.json() as Record<string, unknown>

      if (!res.ok) {
        if (data.error === 'fora_da_janela_24h') {
          loadThread(activeId)   // refresh inWindow flag
          setSendError('Janela de 24h expirada — selecione um template.')
        } else {
          setSendError(typeof data.message === 'string' ? data.message : `Erro ${res.status}`)
        }
        return
      }

      // Optimistic append of the sent message
      setThread(prev => prev ? {
        ...prev,
        messages: [...prev.messages, {
          id:         `opt:${Date.now()}`,
          role:       'ai' as const,
          content:    preview,
          occurredAt: Date.now(),
          metadata:   {},
        }],
      } : prev)
      setTextBody('')
      setSelTemplate(null)
      setTplVars([])
    } catch {
      setSendError('Erro de rede')
    } finally {
      setSending(false)
    }
  }

  function selectTemplate(tpl: WaTemplate) {
    setSelTemplate(tpl)
    setTplVars(Array<string>(countVars(tpl)).fill(''))
  }

  const filteredSessions = search
    ? sessions.filter(s =>
        (s.name ?? '').toLowerCase().includes(search) ||
        s.phone.toLowerCase().includes(search)
      )
    : sessions

  function isUnread(s: SessionItem): boolean {
    if (s.lastContact == null) return false
    const lastOpened = lidas[s.sessionId]
    return lastOpened == null || s.lastContact > lastOpened
  }

  const totalPages = Math.ceil(sessTotal / SESSION_LIMIT)

  // ─── Render ─────────────────────────────────────────────────────────────────

  // Layout by width, all in CSS (the server doesn't know the screen):
  // - from lg: list (280px) and thread side by side, in a box of fixed height
  //   (dvh: on a tablet the browser bars come and go; on desktop dvh = vh);
  // - md to lg: a box of fixed height too, but list and thread take turns
  //   (master-detail) — at 768px with the sidebar pinned the box is ~476px wide,
  //   too narrow for both. The box is 30px shorter than from lg: top bar (60),
  //   <main> padding (2×32) and the sdr-ia tabs (~65) take 190px, so the page
  //   itself doesn't scroll and the composer stays on screen;
  // - below md: the list grows with the page, and an open thread covers the screen
  //   under the top bar (fixed, 100dvh − 60px), header on top and composer at the
  //   bottom, whatever sits above it in the page.
  // data-conv-view tells the sdr-ia layout to hide its tabs behind an open thread
  // on phones; data-hides-ai-launcher takes the floating AI button off the composer
  // below lg (rule in the RESPONSIVO section of app/globals.css).
  return (
    <div data-conv-view={activeId ? 'thread' : 'list'} data-hides-ai-launcher={activeId ? '' : undefined} className="md:h-[calc(100dvh-190px)] md:min-h-[420px] lg:h-[calc(100dvh-160px)]" style={{
      display: 'flex',
      border: '1px solid var(--gray3)', borderRadius: 'var(--radius-lg)', overflow: 'hidden',
      background: 'var(--white)',
    }}>

      {/* ── LEFT: session list ─ full width below lg, gone while a thread is open ── */}
      <div className={cn(
        'flex w-full flex-col lg:w-[280px] lg:shrink-0 lg:border-r lg:border-r-(--gray3)',
        activeId && 'max-lg:hidden',
      )}>
        <div style={{
          padding: '10px 12px 10px 16px', borderBottom: '1px solid var(--gray3)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
        }}>
          <span style={{
            fontSize: 11, fontWeight: 800, textTransform: 'uppercase',
            letterSpacing: '0.08em', color: 'var(--gray2)',
          }}>WhatsApp</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {syncFeedback && (
              <span style={{
                fontSize: 10, fontWeight: 700,
                color: syncFeedback === 'success' ? 'var(--success-text)' : 'var(--danger-text)',
              }}>
                {syncFeedback === 'success' ? 'Sincronizado' : 'Falha ao sincronizar'}
              </span>
            )}
            <button
              onClick={() => { void syncNow() }}
              disabled={syncing}
              title="Sincronizar conversas agora"
              className="max-md:min-h-10"
              style={{
                fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 'var(--radius-pill)',
                border: '1px solid var(--gray3)', background: 'transparent',
                fontFamily: 'inherit', cursor: syncing ? 'not-allowed' : 'pointer',
                color: syncing ? 'var(--gray3)' : 'var(--gray2)',
              }}
            >
              {syncing ? '⟳' : '↺'} Sincronizar
            </button>
          </div>
        </div>

        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--gray3)' }}>
          <input
            ref={searchInputRef}
            type="search"
            value={searchRaw}
            onChange={e => setSearchRaw(e.target.value)}
            placeholder="Buscar..."
            style={{
              width: '100%', boxSizing: 'border-box',
              fontFamily: 'inherit', fontSize: 12,
              padding: '7px 12px', border: '1px solid var(--gray3)',
              borderRadius: 'var(--radius-sm)', background: 'var(--bg)', color: 'var(--black)',
            }}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {permitido && sessLoading && <SkeletonSessionList items={7} />}
          {!permitido && (
            <ApiErrorState texto={textoDeModuloDesligado(moduleKey!)} compacto className="m-3" />
          )}
          {permitido && sessError != null && (
            <ApiErrorState
              texto={textoDaFalha(sessError, 'as conversas')}
              compacto
              className="m-3"
              onRetry={() => setSyncEpoch(e => e + 1)}
            />
          )}
          {permitido && !sessLoading && sessError == null && sessions.length === 0 && (
            <p style={{ padding: '20px 16px', fontSize: 12, color: 'var(--gray2)', margin: 0 }}>
              Nenhuma conversa ainda
            </p>
          )}
          {permitido && !sessLoading && sessError == null && sessions.length > 0 && filteredSessions.length === 0 && (
            <p style={{ padding: '20px 16px', fontSize: 12, color: 'var(--gray2)', margin: 0 }}>
              Nenhum resultado
            </p>
          )}
          {filteredSessions.map(s => {
            const isActive = s.sessionId === activeId
            const unread   = !isActive && isUnread(s)
            const initial  = (s.name ?? s.phone).slice(0, 1).toUpperCase()
            return (
              <button
                key={s.sessionId}
                data-session-id={s.sessionId}
                onClick={() => openFromList(s.sessionId)}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 9,
                  width: '100%', textAlign: 'left',
                  padding: '10px 12px', background: isActive ? 'rgba(0,0,0,0.04)' : 'transparent',
                  border: 'none', borderBottom: '1px solid var(--gray3)',
                  borderLeft: `3px solid ${isActive ? 'var(--primary)' : 'transparent'}`,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <div style={{
                  width: 30, height: 30, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                  background: 'rgba(0,0,0,0.07)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 800, color: 'var(--black)',
                }}>
                  {initial}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', gap: 4, marginBottom: 2,
                  }}>
                    <span title={s.name ?? s.phone} style={{
                      fontSize: 13, fontWeight: unread ? 800 : 700, color: 'var(--black)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                    }}>
                      {s.name ?? s.phone}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      {unread && (
                        <span style={{
                          width: 7, height: 7, borderRadius: '50%',
                          background: 'var(--primary)', display: 'inline-block',
                        }} />
                      )}
                      <span style={{ fontSize: 10, color: 'var(--gray2)', fontWeight: 500 }}>
                        {timeAgo(s.lastContact)}
                      </span>
                    </div>
                  </div>
                  <div style={{
                    fontSize: 11, color: 'var(--gray)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {s.lastMessage.role !== 'human' && '↗ '}
                    {s.lastMessage.content}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--gray2)', marginTop: 2 }}>
                    {s.msgs} msg{s.msgs !== 1 ? 's' : ''}
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Pager: at the ends of the 280px column from lg; below lg the list is
            full width and the pager centers, clear of the floating AI button */}
        {totalPages > 1 && (
          <div className="justify-center gap-[12px] lg:justify-between lg:gap-[6px]" style={{
            padding: '8px 10px', borderTop: '1px solid var(--gray3)',
            display: 'flex', alignItems: 'center',
          }}>
            <button
              onClick={() => setSessPage(p => p - 1)}
              disabled={sessPage <= 1}
              className="max-md:min-h-10"
              style={pagerStyle(sessPage > 1)}
            >← Ant</button>
            <span style={{ fontSize: 10, color: 'var(--gray2)' }}>{sessPage}/{totalPages}</span>
            <button
              onClick={() => setSessPage(p => p + 1)}
              disabled={sessPage >= totalPages}
              className="max-md:min-h-10"
              style={pagerStyle(sessPage < totalPages)}
            >Próx →</button>
          </div>
        )}
      </div>

      {/* ── RIGHT: thread ──────────────────────────────────────────────────── */}
      {/* The empty state only exists beside the list (from lg) */}
      {!activeId ? (
        <div className="hidden flex-1 items-center justify-center lg:flex" style={{
          color: 'var(--gray2)', fontSize: 13,
        }}>
          Selecione uma conversa
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col max-md:fixed max-md:inset-x-0 max-md:top-[60px] max-md:z-[100] max-md:h-[calc(100dvh-60px)] max-md:bg-(--white)">

          {/* header — below lg it opens with the way back to the list */}
          <div className="gap-2 px-3 md:gap-3 md:px-[18px]" style={{
            paddingTop: 11, paddingBottom: 11, borderBottom: '1px solid var(--gray3)',
            display: 'flex', alignItems: 'center', flexShrink: 0, minHeight: 56,
          }}>
            <button
              ref={backBtnRef}
              type="button"
              onClick={closeThread}
              aria-label="Voltar para a lista de conversas"
              title="Voltar para a lista de conversas"
              className="-ml-1 flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-(--black) hover:bg-(--bg) lg:hidden"
            >
              <ArrowLeft size={20} aria-hidden />
            </button>
            {threadLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                <Skeleton circle width={34} height={34} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, flex: 1 }}>
                  <Skeleton width="40%" height={13} />
                  <Skeleton width="25%" height={10} />
                </div>
              </div>
            ) : thread ? (
              <>
                <div style={{
                  width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                  background: 'rgba(0,0,0,0.07)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 15, fontWeight: 800, color: 'var(--black)',
                }}>
                  {(thread.contact.name ?? thread.contact.phone).slice(0, 1).toUpperCase()}
                </div>
                {/* Below lg the name shares the row with the back button and the
                    window pill: one line, ellipsis, full name in the title */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="max-lg:truncate" title={thread.contact.name ?? thread.contact.phone} style={{ fontSize: 14, fontWeight: 800, color: 'var(--black)' }}>
                    {thread.contact.name ?? thread.contact.phone}
                  </div>
                  {thread.contact.name && (
                    <div className="max-lg:truncate" title={thread.contact.phone} style={{ fontSize: 11, color: 'var(--gray2)', fontFamily: 'monospace' }}>
                      {thread.contact.phone}
                    </div>
                  )}
                </div>
                <div style={{ flexShrink: 0 }}>
                  {thread.inWindow ? (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 'var(--radius-pill)',
                      background: 'var(--success-dim)', color: 'var(--success-text)',
                      border: '1px solid var(--success-mid)',
                    }}>● Janela aberta</span>
                  ) : (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 'var(--radius-pill)',
                      background: 'rgba(180,50,0,0.06)', color: 'var(--danger-text)',
                      border: '1px solid rgba(180,50,0,0.18)',
                      display: 'inline-flex', alignItems: 'center', gap: 3,
                    }}><X size={9} /> Janela encerrada</span>
                  )}
                </div>
              </>
            ) : null}
          </div>

          {/* messages area */}
          <div ref={scrollAreaRef} className="px-3 md:px-[18px]" style={{
            flex: 1, overflowY: 'auto', paddingTop: 14, paddingBottom: 14,
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            {!threadLoading && threadError != null && (
              <ApiErrorState
                texto={textoDaFalha(threadError, 'esta conversa')}
                compacto
                onRetry={() => loadThread(activeId!)}
              />
            )}
            {threadError == null && thread?.messages.length === 0 && (
              <p style={{ margin: 'auto', fontSize: 12, color: 'var(--gray2)' }}>
                Nenhuma mensagem nesta conversa
              </p>
            )}
            {thread && (() => {
              const nodes: ReactNode[] = []
              let prevKey: string | null = null
              for (const m of thread.messages) {
                const key = m.occurredAt != null ? dayKey(m.occurredAt) : null
                if (key && key !== prevKey) {
                  nodes.push(<DateSeparator key={`sep:${key}`} label={dayLabel(key)} />)
                  prevKey = key
                }
                nodes.push(<Bubble key={m.id} msg={m} />)
              }
              return nodes
            })()}
            <div ref={bottomRef} />
          </div>

          {/* composer — pinned under the messages. On phones, if a template with
              many variables won't fit (keyboard open), it scrolls inside itself
              instead of pushing its bottom out of the screen. */}
          {thread && (
            <div className="max-md:max-h-[60%] max-md:overflow-y-auto" style={{
              borderTop: '1px solid var(--gray3)', padding: '12px 16px', flexShrink: 0,
            }}>
              {sendError && (
                <div style={{
                  marginBottom: 8, padding: '7px 12px', borderRadius: 'var(--radius-sm)', fontSize: 12, fontWeight: 600,
                  background: 'rgba(192,57,43,0.06)', border: '1px solid rgba(192,57,43,0.22)',
                  color: 'var(--danger-text)',
                }}>
                  {sendError}
                </div>
              )}

              {thread.inWindow ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <textarea
                    value={textBody}
                    onChange={e => setTextBody(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        void send()
                      }
                    }}
                    placeholder="Digite sua mensagem... (Enter para enviar, Shift+Enter para nova linha)"
                    rows={2}
                    className="min-w-0"
                    style={{
                      flex: 1, fontFamily: 'inherit', fontSize: 13,
                      resize: 'none', padding: '9px 13px', borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--gray3)', background: 'var(--bg)',
                      color: 'var(--black)', lineHeight: 1.5,
                    }}
                  />
                  <SendBtn
                    label="Enviar"
                    disabled={!textBody.trim() || sending}
                    loading={sending}
                    onClick={() => { void send() }}
                  />
                </div>
              ) : tplError != null ? (
                <ApiErrorState
                  texto={textoDaFalha(tplError, 'os modelos de mensagem')}
                  compacto
                  onRetry={() => { setTplLoaded(false); setTplError(null) }}
                />
              ) : (
                <TemplateComposer
                  templates={templates}
                  loading={tplLoading}
                  selected={selTemplate}
                  vars={tplVars}
                  windowExpiresAt={thread.windowExpiresAt}
                  sending={sending}
                  onSelect={selectTemplate}
                  onVarChange={(i, v) => setTplVars(prev => {
                    const next = [...prev]
                    next[i] = v
                    return next
                  })}
                  onSend={() => { void send() }}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
