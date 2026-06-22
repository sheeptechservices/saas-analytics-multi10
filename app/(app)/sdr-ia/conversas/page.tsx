'use client'
import { useEffect, useRef, useState } from 'react'
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
  const isHuman = msg.role === 'human'
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
        <div style={{ fontSize: 10, opacity: 0.55, textAlign: isHuman ? 'left' : 'right' }}>
          {timeAgo(msg.occurredAt)}
        </div>
      </div>
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

  const bottomRef  = useRef<HTMLDivElement>(null)
  // Stale-fetch guard: ensures a slow earlier fetch can't overwrite a later thread
  const fetchIdRef = useRef(0)

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

  // ── Auto-scroll to bottom whenever thread (or its messages) changes ─────────
  useEffect(() => {
    if (thread) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread])

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

  // ── Open a session ──────────────────────────────────────────────────────────
  function loadThread(sessionId: string) {
    const fetchId = ++fetchIdRef.current
    setActiveId(sessionId)
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
          {sessions.map(s => {
            const isActive = s.sessionId === activeId
            return (
              <button
                key={s.sessionId}
                onClick={() => loadThread(s.sessionId)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '11px 14px', background: isActive ? 'rgba(0,0,0,0.04)' : 'transparent',
                  border: 'none', borderBottom: '1px solid var(--gray3)',
                  borderLeft: `3px solid ${isActive ? 'var(--primary)' : 'transparent'}`,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 2 }}>
                  <span style={{
                    fontSize: 13, fontWeight: 700, color: 'var(--black)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                  }}>
                    {s.name ?? s.phone}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--gray2)', fontWeight: 500, flexShrink: 0 }}>
                    {timeAgo(s.lastContact)}
                  </span>
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
          <div style={{
            flex: 1, overflowY: 'auto', padding: '14px 18px',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            {thread?.messages.length === 0 && (
              <p style={{ margin: 'auto', fontSize: 12, color: 'var(--gray2)' }}>
                Nenhuma mensagem nesta conversa
              </p>
            )}
            {thread?.messages.map(m => <Bubble key={m.id} msg={m} />)}
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
