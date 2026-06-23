'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { CSSProperties } from 'react'
import { timeAgo } from '@/lib/format'

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
    fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 99,
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
      <div style={{
        maxWidth: '72%', padding: '8px 12px', wordBreak: 'break-word',
        borderRadius: isHuman ? '4px 12px 12px 12px' : '12px 4px 12px 12px',
        background: isHuman ? 'var(--bg)' : 'var(--primary)',
        border: isHuman ? '1px solid var(--gray3)' : 'none',
        color: isHuman ? 'var(--black)' : '#fff',
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
              fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 4,
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
        background: 'rgba(0,0,0,0.05)', padding: '3px 12px', borderRadius: 99,
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
    <button onClick={onClick} disabled={disabled} style={{
      padding: '9px 20px', borderRadius: 12, border: 'none',
      fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
      cursor: disabled ? 'not-allowed' : 'pointer', flexShrink: 0,
      background: disabled ? 'var(--gray3)' : 'var(--primary)',
      color: disabled ? 'var(--gray2)' : '#fff',
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
        marginBottom: 10, padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
        background: 'rgba(217,150,0,0.06)', border: '1px solid rgba(217,150,0,0.25)', color: '#92650a',
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
                border: '1px solid var(--gray3)', borderRadius: 8,
                background: 'var(--bg)', color: 'var(--black)', outline: 'none',
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
                      border: '1px solid var(--gray3)', borderRadius: 8,
                      background: 'var(--bg)', color: 'var(--black)', outline: 'none',
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
  // Session list
  const [sessions,    setSessions]    = useState<SessionItem[]>([])
  const [sessTotal,   setSessTotal]   = useState(0)
  const [sessPage,    setSessPage]    = useState(1)
  const [sessLoading, setSessLoading] = useState(true)
  const [sessError,   setSessError]   = useState(false)

  // Active thread
  const [activeId,      setActiveId]      = useState<string | null>(null)
  const [thread,        setThread]        = useState<Thread | null>(null)
  const [threadLoading, setThreadLoading] = useState(false)

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

  // ── Fetch session list ──────────────────────────────────────────────────────
  useEffect(() => {
    setSessLoading(true)
    setSessError(false)
    fetch(`/api/ycloud/conversations?page=${sessPage}&limit=${SESSION_LIMIT}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: { items: SessionItem[]; total: number }) => {
        setSessions(d.items)
        setSessTotal(d.total)
      })
      .catch(() => setSessError(true))
      .finally(() => setSessLoading(false))
  }, [sessPage])

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
      fetch('/api/ycloud/templates')
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then((d: { templates: WaTemplate[] }) =>
          setTemplates(d.templates.filter(t => t.status === 'approved'))
        )
        .catch(() => setTemplates([]))
        .finally(() => { setTplLoading(false); setTplLoaded(true) })
    }
  }, [thread, tplLoaded, tplLoading])

  // Keep refs in sync with state so the polling interval (empty deps) reads fresh values
  useEffect(() => { activeIdRef.current = activeId }, [activeId])
  useEffect(() => { sessPageRef.current = sessPage }, [sessPage])

  // Hydrate lidas from localStorage on mount (client-only)
  useEffect(() => {
    const stored = readLidas()
    lidasRef.current = stored
    setLidas(stored)
  }, [])

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

      // Refresh session list — no setSessLoading, so no spinner
      fetch(`/api/ycloud/conversations?page=${sessPageRef.current}&limit=${SESSION_LIMIT}`)
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then((d: { items: SessionItem[]; total: number }) => {
          setSessions(d.items)
          setSessTotal(d.total)
        })
        .catch(() => {})

      // Refresh active thread — guard against stale response with captured id check
      const currentId = activeIdRef.current
      if (currentId) {
        fetch(`/api/ycloud/conversations/${encodeURIComponent(currentId)}`)
          .then(r => r.ok ? r.json() : Promise.reject(r.status))
          .then((d: Thread) => { if (activeIdRef.current === currentId) setThread(d) })
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
    setSendError(null)
    setTextBody('')
    setSelTemplate(null)
    setTplVars([])
    fetch(`/api/ycloud/conversations/${encodeURIComponent(sessionId)}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: Thread) => { if (fetchIdRef.current === fetchId) setThread(d) })
      .catch(() => {})
      .finally(() => { if (fetchIdRef.current === fetchId) setThreadLoading(false) })
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

  return (
    <div style={{
      display: 'flex', height: 'calc(100vh - 160px)', minHeight: 420,
      border: '1px solid var(--gray3)', borderRadius: 16, overflow: 'hidden',
      background: '#fff',
    }}>

      {/* ── LEFT: session list ─────────────────────────────────────────────── */}
      <div style={{
        width: 280, flexShrink: 0, borderRight: '1px solid var(--gray3)',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid var(--gray3)',
          fontSize: 11, fontWeight: 800, textTransform: 'uppercase',
          letterSpacing: '0.08em', color: 'var(--gray2)',
        }}>
          WhatsApp
        </div>

        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--gray3)' }}>
          <input
            type="search"
            value={searchRaw}
            onChange={e => setSearchRaw(e.target.value)}
            placeholder="Buscar..."
            style={{
              width: '100%', boxSizing: 'border-box',
              fontFamily: 'inherit', fontSize: 12,
              padding: '7px 12px', border: '1px solid var(--gray3)',
              borderRadius: 8, background: 'var(--bg)', color: 'var(--black)',
              outline: 'none',
            }}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {sessLoading && (
            <p style={{ padding: '20px 16px', fontSize: 12, color: 'var(--gray2)', margin: 0 }}>
              Carregando...
            </p>
          )}
          {sessError && (
            <p style={{ padding: '20px 16px', fontSize: 12, color: '#c0392b', margin: 0 }}>
              Falha ao carregar conversas
            </p>
          )}
          {!sessLoading && !sessError && sessions.length === 0 && (
            <p style={{ padding: '20px 16px', fontSize: 12, color: 'var(--gray2)', margin: 0 }}>
              Nenhuma conversa ainda
            </p>
          )}
          {!sessLoading && !sessError && sessions.length > 0 && filteredSessions.length === 0 && (
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
                onClick={() => loadThread(s.sessionId)}
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
                    <span style={{
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

        {totalPages > 1 && (
          <div style={{
            padding: '8px 10px', borderTop: '1px solid var(--gray3)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6,
          }}>
            <button
              onClick={() => setSessPage(p => p - 1)}
              disabled={sessPage <= 1}
              style={pagerStyle(sessPage > 1)}
            >← Ant</button>
            <span style={{ fontSize: 10, color: 'var(--gray2)' }}>{sessPage}/{totalPages}</span>
            <button
              onClick={() => setSessPage(p => p + 1)}
              disabled={sessPage >= totalPages}
              style={pagerStyle(sessPage < totalPages)}
            >Próx →</button>
          </div>
        )}
      </div>

      {/* ── RIGHT: thread ──────────────────────────────────────────────────── */}
      {!activeId ? (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--gray2)', fontSize: 13,
        }}>
          Selecione uma conversa
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

          {/* header */}
          <div style={{
            padding: '11px 18px', borderBottom: '1px solid var(--gray3)',
            display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, minHeight: 56,
          }}>
            {threadLoading ? (
              <span style={{ fontSize: 13, color: 'var(--gray2)' }}>Carregando...</span>
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
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--black)' }}>
                    {thread.contact.name ?? thread.contact.phone}
                  </div>
                  {thread.contact.name && (
                    <div style={{ fontSize: 11, color: 'var(--gray2)', fontFamily: 'monospace' }}>
                      {thread.contact.phone}
                    </div>
                  )}
                </div>
                <div style={{ flexShrink: 0 }}>
                  {thread.inWindow ? (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
                      background: 'rgba(30,138,62,0.08)', color: '#166534',
                      border: '1px solid rgba(30,138,62,0.22)',
                    }}>● Janela aberta</span>
                  ) : (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
                      background: 'rgba(180,50,0,0.06)', color: '#9a2008',
                      border: '1px solid rgba(180,50,0,0.18)',
                    }}>✕ Janela encerrada</span>
                  )}
                </div>
              </>
            ) : null}
          </div>

          {/* messages area */}
          <div ref={scrollAreaRef} style={{
            flex: 1, overflowY: 'auto', padding: '14px 18px',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            {thread?.messages.length === 0 && (
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

          {/* composer */}
          {thread && (
            <div style={{
              borderTop: '1px solid var(--gray3)', padding: '12px 16px', flexShrink: 0,
            }}>
              {sendError && (
                <div style={{
                  marginBottom: 8, padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  background: 'rgba(192,57,43,0.06)', border: '1px solid rgba(192,57,43,0.22)',
                  color: '#9a2008',
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
                    style={{
                      flex: 1, fontFamily: 'inherit', fontSize: 13,
                      resize: 'none', padding: '9px 13px', borderRadius: 12,
                      border: '1px solid var(--gray3)', background: 'var(--bg)',
                      color: 'var(--black)', outline: 'none', lineHeight: 1.5,
                    }}
                  />
                  <SendBtn
                    label="Enviar"
                    disabled={!textBody.trim() || sending}
                    loading={sending}
                    onClick={() => { void send() }}
                  />
                </div>
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
