'use client'
import { useState, useRef, useEffect, useCallback } from 'react'

type Message = { id: number; role: 'user' | 'assistant'; content: string; streaming?: boolean }

let _id = Date.now()
const uid = () => ++_id

const WELCOME: Message = {
  id: uid(),
  role: 'assistant',
  content: 'Olá! Posso analisar seus dados de pipeline, tirar dúvidas sobre o sistema ou ajudar com a integração Kommo.\n\nComo posso ajudar?',
}

const SUGGESTIONS = [
  'Quantos leads tenho?',
  'Qual minha taxa de conversão?',
  'Como integro o Kommo?',
  'Como usar o Pipeline?',
  'Como personalizar a plataforma?',
]

const HINT_KEY = 'ai-hint-dismissed'

export function AIAssistant() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([WELCOME])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [context, setContext] = useState<any>(null)
  const [hint, setHint] = useState(false)
  const [hintVisible, setHintVisible] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sendRef = useRef<(text?: string) => Promise<void>>(async () => {})

  // Show hint on first load if not yet dismissed
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (localStorage.getItem(HINT_KEY)) return
    const t1 = setTimeout(() => { setHint(true); setTimeout(() => setHintVisible(true), 30) }, 1200)
    const t2 = setTimeout(() => dismissHint(), 8000)
    hintTimerRef.current = t2
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  function dismissHint() {
    setHintVisible(false)
    setTimeout(() => setHint(false), 350)
    localStorage.setItem(HINT_KEY, '1')
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
  }

  function openChat() {
    dismissHint()
    setOpen(o => !o)
  }

  useEffect(() => {
    if (open && !context) {
      fetch('/api/bi').then(r => r.json()).then(setContext).catch(() => {})
    }
  }, [open])

  useEffect(() => {
    if (open) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  function resizeTextarea() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }

  const send = useCallback(async (text?: string) => {
    const msg = (text ?? input).trim()
    if (!msg || loading) return

    const userMsg: Message = { id: uid(), role: 'user', content: msg }
    const aiPlaceholder: Message = { id: uid(), role: 'assistant', content: '', streaming: true }
    const history = [...messages.filter(m => !m.streaming), userMsg]
    setMessages([...history, aiPlaceholder])
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setLoading(true)

    try {
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.map(m => ({ role: m.role, content: m.content })),
          context,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao conectar com o assistente.' }))
        setMessages(prev => [
          ...prev.slice(0, -1),
          { id: uid(), role: 'assistant', content: err.error ?? 'Erro desconhecido.' },
        ])
        return
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let aiText = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        aiText += decoder.decode(value, { stream: true })
        setMessages(prev => [
          ...prev.slice(0, -1),
          { ...prev[prev.length - 1], content: aiText, streaming: true },
        ])
      }
      setMessages(prev => [
        ...prev.slice(0, -1),
        { ...prev[prev.length - 1], content: aiText, streaming: false },
      ])
    } catch {
      setMessages(prev => [
        ...prev.slice(0, -1),
        { id: uid(), role: 'assistant', content: 'Não foi possível conectar ao assistente. Tente novamente.' },
      ])
    } finally {
      setLoading(false)
    }
  }, [input, loading, messages, context])

  // Keep sendRef current so the ai-ask event handler always calls the latest version
  useEffect(() => { sendRef.current = send }, [send])

  // Listen for chart "Analisar" button events
  useEffect(() => {
    function handler(e: Event) {
      const { question } = (e as CustomEvent).detail
      dismissHint()
      setOpen(true)
      setTimeout(() => sendRef.current(question), 120)
    }
    window.addEventListener('ai-ask', handler)
    return () => window.removeEventListener('ai-ask', handler)
  }, [])

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const showSuggestions = messages.length === 1 && !loading

  return (
    <>
      {/* Breathing glow ring behind button */}
      <div style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 208,
        width: 52, height: 52, borderRadius: '50%',
        background: 'var(--primary)',
        animation: open ? 'none' : 'breathe-ring 2.8s ease-in-out infinite',
        pointerEvents: 'none',
        opacity: open ? 0 : undefined,
        transition: 'opacity 0.3s ease',
      }} />

      {/* Hint bubble */}
      {hint && (
        <div style={{
          position: 'fixed',
          bottom: 86,
          right: 24,
          zIndex: 215,
          width: 240,
          background: 'var(--black)',
          color: '#fff',
          borderRadius: 14,
          padding: '13px 14px 13px 14px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
          opacity: hintVisible ? 1 : 0,
          transform: hintVisible ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.95)',
          transition: 'opacity 0.35s ease, transform 0.4s cubic-bezier(0.34,1.3,0.64,1)',
          pointerEvents: hintVisible ? 'all' : 'none',
        }}>
          {/* Arrow pointing down to button */}
          <div style={{
            position: 'absolute', bottom: -7, right: 22,
            width: 14, height: 14,
            background: 'var(--black)',
            transform: 'rotate(45deg)',
            borderRadius: 2,
          }} />

          {/* Dismiss X */}
          <button
            onClick={dismissHint}
            style={{
              position: 'absolute', top: 8, right: 8,
              width: 20, height: 20, borderRadius: '50%',
              border: 'none', background: 'rgba(255,255,255,0.12)',
              color: 'rgba(255,255,255,0.6)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontFamily: 'inherit',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.22)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.12)')}
          >✕</button>

          {/* Spark icon */}
          <div style={{ fontSize: 18, marginBottom: 7, lineHeight: 1 }}>✦</div>

          <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.45, marginBottom: 8 }}>
            Pergunte à IA sobre seus dados!
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', lineHeight: 1.5, marginBottom: 11 }}>
            Insights do pipeline, previsões, dicas de conversão, métricas e como usar o sistema.
          </div>

          {/* Tags */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {['📊 Insights', '🔮 Previsões', '🔗 Integrações', '⚙️ Dúvidas'].map(tag => (
              <span key={tag} style={{
                fontSize: 10, fontWeight: 600, padding: '3px 8px',
                borderRadius: 100, background: 'rgba(255,255,255,0.10)',
                color: 'rgba(255,255,255,0.75)', border: '1px solid rgba(255,255,255,0.12)',
              }}>{tag}</span>
            ))}
          </div>

          {/* CTA */}
          <button
            onClick={openChat}
            style={{
              marginTop: 12, width: '100%', padding: '8px',
              borderRadius: 8, border: 'none',
              background: 'var(--primary)', color: 'var(--primary-contrast)',
              fontSize: 12, fontWeight: 800, cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'opacity 0.15s, transform 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.88'; e.currentTarget.style.transform = 'translateY(-1px)' }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(0)' }}
          >
            Experimentar agora →
          </button>
        </div>
      )}

      {/* FAB button */}
      <FABButton open={open} onClick={openChat} />

      {/* Panel — always rendered, transitions in/out */}
      <div style={{
        position: 'fixed',
        bottom: open ? 88 : 76,
        right: 24,
        width: 390,
        height: 540,
        background: 'var(--white)',
        border: '1px solid var(--gray3)',
        borderRadius: 20,
        boxShadow: open
          ? '0 16px 56px rgba(0,0,0,0.18), 0 4px 16px rgba(0,0,0,0.08)'
          : '0 4px 16px rgba(0,0,0,0.06)',
        zIndex: 300,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        opacity: open ? 1 : 0,
        transform: open ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.94)',
        pointerEvents: open ? 'all' : 'none',
        transition: open
          ? 'opacity 0.35s ease, transform 0.4s cubic-bezier(0.34,1.35,0.64,1), bottom 0.3s ease, box-shadow 0.3s ease'
          : 'opacity 0.22s ease, transform 0.25s cubic-bezier(0.4,0,1,1), bottom 0.2s ease, box-shadow 0.2s ease',
      }}>
        {/* Header */}
        <div style={{
          padding: '13px 14px 13px 16px',
          borderBottom: '1px solid var(--gray3)',
          background: 'linear-gradient(135deg, var(--primary-dim) 0%, var(--white) 70%)',
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        }}>
          <div style={{
            width: 34, height: 34, borderRadius: '50%',
            background: 'var(--primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 15, color: 'var(--primary-contrast)',
            boxShadow: '0 2px 8px rgba(255,180,0,0.4)',
            animation: 'spin-slow 24s linear infinite',
            flexShrink: 0,
          }}>✦</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--black)' }}>Assistente IA</div>
            <div style={{ fontSize: 10, color: 'var(--gray)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{
                width: 5, height: 5, borderRadius: '50%', flexShrink: 0, display: 'inline-block',
                background: loading ? 'var(--primary)' : 'var(--green)',
                animation: 'pulse-dot 2s ease-in-out infinite',
                transition: 'background 0.3s',
              }} />
              <span style={{ transition: 'opacity 0.2s' }}>
                {loading ? 'digitando…' : 'online · dados em tempo real'}
              </span>
            </div>
          </div>
          <span style={{
            fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 100,
            background: 'var(--primary-dim)', border: '1px solid var(--primary-mid)',
            color: 'var(--primary-text)', letterSpacing: '0.05em', flexShrink: 0,
          }}>BETA</span>
          <button
            onClick={() => setOpen(false)}
            style={{
              width: 26, height: 26, borderRadius: '50%', border: 'none',
              background: 'transparent', cursor: 'pointer', color: 'var(--gray2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, transition: 'background 0.15s, color 0.15s, transform 0.15s',
              flexShrink: 0, fontFamily: 'inherit',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--gray3)'; e.currentTarget.style.color = 'var(--black)'; e.currentTarget.style.transform = 'scale(1.1)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--gray2)'; e.currentTarget.style.transform = 'scale(1)' }}
          >✕</button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 12px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {messages.map((msg, i) => (
            <MessageBubble key={msg.id} msg={msg} delay={i === 0 ? 0 : 0} />
          ))}
          {loading && messages[messages.length - 1]?.content === '' && <ThinkingDots />}
          {showSuggestions && (
            <div style={{
              marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6,
              opacity: open ? 1 : 0,
              transform: open ? 'translateY(0)' : 'translateY(6px)',
              transition: 'opacity 0.35s ease 0.25s, transform 0.35s ease 0.25s',
            }}>
              {SUGGESTIONS.map(s => (
                <SuggestionChip key={s} text={s} onSelect={() => send(s)} />
              ))}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div style={{ padding: '8px 12px 12px', borderTop: '1px solid var(--gray3)', background: 'var(--bg)', flexShrink: 0 }}>
          <InputArea
            value={input}
            textareaRef={textareaRef}
            onChange={e => { setInput(e.target.value); resizeTextarea() }}
            onKeyDown={onKeyDown}
            onSend={() => send()}
            canSend={!!input.trim() && !loading}
            loading={loading}
          />
          <div style={{ fontSize: 10, color: 'var(--gray2)', marginTop: 5, textAlign: 'center', fontWeight: 500, opacity: 0.75 }}>
            Enter para enviar · Shift+Enter para nova linha
          </div>
        </div>
      </div>
    </>
  )
}

// ─── FABButton ────────────────────────────────────────────────────────────────

function FABButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  const [hov, setHov] = useState(false)
  const [press, setPress] = useState(false)

  return (
    <button
      onClick={() => { setPress(true); setTimeout(() => setPress(false), 220); onClick() }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      title="Assistente IA"
      style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 210,
        width: 52, height: 52, borderRadius: '50%',
        background: open ? '#1a1c20' : 'var(--primary)',
        color: open ? '#fff' : 'var(--primary-contrast)',
        border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 20, fontWeight: 800,
        boxShadow: hov && !open
          ? '0 8px 28px rgba(255,180,0,0.5), 0 2px 8px rgba(0,0,0,0.15)'
          : open
          ? '0 4px 18px rgba(0,0,0,0.3)'
          : '0 3px 14px rgba(0,0,0,0.18)',
        transform: press
          ? 'scale(0.86)'
          : hov
          ? 'scale(1.13) translateY(-2px)'
          : 'scale(1)',
        transition: 'background 0.3s ease, box-shadow 0.3s ease, transform 0.18s cubic-bezier(0.34,1.56,0.64,1)',
        fontFamily: 'inherit', outline: 'none',
      }}
    >
      <span style={{
        display: 'inline-block',
        transition: 'transform 0.35s cubic-bezier(0.34,1.4,0.64,1)',
        transform: open ? 'rotate(135deg) scale(0.9)' : 'rotate(0deg) scale(1)',
      }}>
        {open ? '✕' : '✦'}
      </span>
    </button>
  )
}

// ─── InputArea ────────────────────────────────────────────────────────────────

function InputArea({ value, textareaRef, onChange, onKeyDown, onSend, canSend, loading }: {
  value: string
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  onChange: React.ChangeEventHandler<HTMLTextAreaElement>
  onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement>
  onSend: () => void
  canSend: boolean
  loading: boolean
}) {
  const [focused, setFocused] = useState(false)
  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'flex-end',
      background: 'var(--white)',
      border: `1.5px solid ${focused ? 'var(--primary)' : 'var(--gray3)'}`,
      borderRadius: 14, padding: '8px 8px 8px 12px',
      boxShadow: focused ? '0 0 0 3px var(--primary-dim)' : 'none',
      transition: 'border-color 0.22s ease, box-shadow 0.22s ease',
    }}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Pergunte sobre seus dados…"
        rows={1}
        style={{
          flex: 1, resize: 'none', border: 'none', outline: 'none',
          fontFamily: 'inherit', fontSize: 13, color: 'var(--black)',
          background: 'transparent', lineHeight: 1.5,
          minHeight: 20, maxHeight: 120, overflowY: 'auto', paddingTop: 1,
        }}
      />
      <SendButton active={canSend} loading={loading} onClick={onSend} />
    </div>
  )
}

// ─── SendButton ───────────────────────────────────────────────────────────────

function SendButton({ active, loading, onClick }: { active: boolean; loading: boolean; onClick: () => void }) {
  const [hov, setHov] = useState(false)
  const [press, setPress] = useState(false)
  return (
    <button
      onClick={() => { if (!active) return; setPress(true); setTimeout(() => setPress(false), 200); onClick() }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      disabled={!active}
      style={{
        width: 32, height: 32, borderRadius: '50%', border: 'none',
        background: active ? 'var(--primary)' : 'var(--gray3)',
        color: active ? 'var(--primary-contrast)' : 'var(--gray2)',
        cursor: active ? 'pointer' : 'default',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, fontSize: 16, fontFamily: 'inherit',
        transform: press ? 'scale(0.82)' : hov && active ? 'scale(1.12)' : 'scale(1)',
        boxShadow: hov && active ? '0 4px 14px rgba(255,180,0,0.45)' : 'none',
        transition: 'background 0.2s, color 0.2s, transform 0.18s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.2s',
        animation: loading ? 'pulse-dot 1s ease-in-out infinite' : 'none',
      }}
    >↑</button>
  )
}

// ─── SuggestionChip ───────────────────────────────────────────────────────────

function SuggestionChip({ text, onSelect }: { text: string; onSelect: () => void }) {
  const [hov, setHov] = useState(false)
  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        fontSize: 11, fontWeight: 600, padding: '5px 11px', borderRadius: 100,
        background: hov ? 'var(--primary)' : 'var(--bg)',
        color: hov ? 'var(--primary-contrast)' : 'var(--gray)',
        border: `1px solid ${hov ? 'var(--primary)' : 'var(--gray3)'}`,
        cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
        transform: hov ? 'translateY(-2px)' : 'translateY(0)',
        boxShadow: hov ? '0 3px 10px rgba(255,180,0,0.3)' : 'none',
        transition: 'all 0.18s cubic-bezier(0.34,1.56,0.64,1)',
      }}
    >{text}</button>
  )
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg, delay }: { msg: Message; delay: number }) {
  const [hov, setHov] = useState(false)
  const isUser = msg.role === 'user'
  return (
    <div
      style={{
        display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start',
        animation: `${isUser ? 'msgRight' : 'msgLeft'} 0.28s cubic-bezier(0.22,1,0.36,1) both`,
        animationDelay: `${delay}ms`,
      }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <div style={{
        maxWidth: '85%', padding: '9px 13px',
        borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        background: isUser ? 'var(--primary)' : 'var(--bg)',
        color: isUser ? 'var(--primary-contrast)' : 'var(--black)',
        border: isUser ? 'none' : '1px solid var(--gray3)',
        fontSize: 13, lineHeight: 1.55,
        fontWeight: isUser ? 600 : 400,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        transform: hov ? 'translateY(-1px)' : 'translateY(0)',
        boxShadow: hov
          ? isUser ? '0 4px 14px rgba(255,180,0,0.28)' : '0 3px 10px rgba(0,0,0,0.08)'
          : 'none',
        transition: 'transform 0.18s ease, box-shadow 0.18s ease',
      }}>
        <MarkdownText text={msg.content} />
        {msg.streaming && msg.content && (
          <span style={{
            display: 'inline-block', width: 2, height: 13,
            background: 'var(--gray)', borderRadius: 1, marginLeft: 3,
            animation: 'blink-cursor 0.65s ease-in-out infinite',
            verticalAlign: 'middle',
          }} />
        )}
      </div>
    </div>
  )
}

// ─── InlineText ──────────────────────────────────────────────────────────────

function InlineText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/)
  return (
    <>
      {parts.map((part, j) => {
        if (part.startsWith('**') && part.endsWith('**'))
          return <strong key={j}>{part.slice(2, -2)}</strong>
        if (part.startsWith('`') && part.endsWith('`'))
          return (
            <code key={j} style={{
              fontSize: 11, padding: '1px 5px', borderRadius: 4,
              background: 'rgba(0,0,0,0.07)', fontFamily: 'monospace',
            }}>{part.slice(1, -1)}</code>
          )
        return <span key={j}>{part}</span>
      })}
    </>
  )
}

// ─── MarkdownText ─────────────────────────────────────────────────────────────

type MdBlock =
  | { type: 'h1' | 'h2' | 'h3'; content: string }
  | { type: 'table'; rows: string[][] }
  | { type: 'text'; lines: string[] }

function parseMarkdown(text: string): MdBlock[] {
  const lines = text.split('\n')
  const blocks: MdBlock[] = []
  let textBuf: string[] = []

  const flushText = () => {
    if (textBuf.length) { blocks.push({ type: 'text', lines: [...textBuf] }); textBuf = [] }
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith('### ')) {
      flushText(); blocks.push({ type: 'h3', content: line.slice(4) }); i++
    } else if (line.startsWith('## ')) {
      flushText(); blocks.push({ type: 'h2', content: line.slice(3) }); i++
    } else if (line.startsWith('# ')) {
      flushText(); blocks.push({ type: 'h1', content: line.slice(2) }); i++
    } else if (line.trim().startsWith('|')) {
      flushText()
      const tableLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]); i++
      }
      const isSep = (l: string) => /^[\|\-\:\s]+$/.test(l.trim())
      const rows = tableLines
        .filter(l => !isSep(l))
        .map(l =>
          l.split('|')
            .slice(1, -1)  // remove first/last empty from outer pipes
            .map(c => c.trim())
        )
      if (rows.length) blocks.push({ type: 'table', rows })
    } else {
      textBuf.push(line); i++
    }
  }
  flushText()
  return blocks
}

function MarkdownText({ text }: { text: string }) {
  const blocks = parseMarkdown(text)

  return (
    <>
      {blocks.map((block, bi) => {
        const mt = bi > 0 ? 10 : 0

        if (block.type === 'h1') return (
          <div key={bi} style={{ fontSize: 14, fontWeight: 800, color: 'var(--black)', marginTop: mt, marginBottom: 6, lineHeight: 1.3 }}>
            <InlineText text={block.content} />
          </div>
        )
        if (block.type === 'h2') return (
          <div key={bi} style={{ fontSize: 13, fontWeight: 800, color: 'var(--black)', marginTop: mt, marginBottom: 5, lineHeight: 1.3 }}>
            <InlineText text={block.content} />
          </div>
        )
        if (block.type === 'h3') return (
          <div key={bi} style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray)', marginTop: mt, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <InlineText text={block.content} />
          </div>
        )

        if (block.type === 'table') {
          const [header, ...body] = block.rows
          return (
            <div key={bi} style={{ overflowX: 'auto', marginTop: mt, marginBottom: 4 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                {header && (
                  <thead>
                    <tr>
                      {header.map((cell, ci) => (
                        <th key={ci} style={{
                          padding: '5px 8px', textAlign: 'left',
                          background: 'rgba(0,0,0,0.05)',
                          fontSize: 10, fontWeight: 800, color: 'var(--gray2)',
                          borderBottom: '2px solid var(--gray3)',
                          whiteSpace: 'nowrap',
                        }}>
                          <InlineText text={cell} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {body.map((row, ri) => (
                    <tr key={ri} style={{ borderBottom: '1px solid var(--gray3)', background: ri % 2 === 1 ? 'rgba(0,0,0,0.02)' : 'transparent' }}>
                      {row.map((cell, ci) => (
                        <td key={ci} style={{ padding: '5px 8px', color: 'var(--black)', verticalAlign: 'top' }}>
                          <InlineText text={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }

        // text block
        const lines = block.type === 'text' ? block.lines : []
        return (
          <span key={bi}>
            {lines.map((line, li) => {
              const isBullet = /^[\s]*[-•]\s/.test(line)
              const content = isBullet ? line.replace(/^[\s]*[-•]\s/, '') : line
              return (
                <span key={li} style={{ display: isBullet ? 'flex' : 'block' }}>
                  {isBullet && <span style={{ marginRight: 6, flexShrink: 0, opacity: 0.5 }}>•</span>}
                  <span><InlineText text={content} /></span>
                  {li < lines.length - 1 && !isBullet && <br />}
                </span>
              )
            })}
          </span>
        )
      })}
    </>
  )
}

// ─── ThinkingDots ─────────────────────────────────────────────────────────────

function ThinkingDots() {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', animation: 'msgLeft 0.22s ease both' }}>
      <div style={{
        padding: '11px 14px', borderRadius: '16px 16px 16px 4px',
        background: 'var(--bg)', border: '1px solid var(--gray3)',
        display: 'flex', gap: 5, alignItems: 'center',
      }}>
        {[0, 1, 2].map(i => (
          <span key={i} style={{
            width: 7, height: 7, borderRadius: '50%',
            background: 'var(--gray2)', display: 'inline-block',
            animation: `pulse-dot 1.1s ease-in-out ${i * 0.18}s infinite`,
          }} />
        ))}
      </div>
    </div>
  )
}
