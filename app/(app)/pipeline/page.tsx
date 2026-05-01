'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { formatCurrency, daysAgo } from '@/lib/utils'

type Priority = 'high' | 'normal' | 'low'

const PRIORITY_LABELS: Record<Priority, { label: string; color: string; bg: string }> = {
  high:   { label: 'Alta',   color: '#b02619', bg: 'rgba(217,48,37,0.08)' },
  normal: { label: 'Normal', color: '#7A5600', bg: 'var(--primary-dim)' },
  low:    { label: 'Baixa',  color: 'var(--gray)', bg: 'var(--bg)' },
}

function LeadExtrasPanel({ lead, onClose, onSave }: { lead: any; onClose: () => void; onSave: (data: any) => void }) {
  const extras = lead.extras ?? {}
  const [tags, setTags] = useState<string[]>(extras.tags ?? [])
  const [notes, setNotes] = useState(extras.notes ?? '')
  const [priority, setPriority] = useState<Priority>(extras.priority ?? 'normal')
  const [newTag, setNewTag] = useState('')
  const [saving, setSaving] = useState(false)

  function addTag() {
    const t = newTag.trim()
    if (t && !tags.includes(t)) setTags([...tags, t])
    setNewTag('')
  }

  async function save() {
    setSaving(true)
    await onSave({ tags, notes, priority })
    setSaving(false)
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 400, display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(18,19,22,0.4)' }} onClick={onClose} />
      <div className="animate-slide-right" style={{
        position: 'relative', width: 400, background: 'var(--white)',
        height: '100%', overflowY: 'auto', boxShadow: '-4px 0 20px rgba(0,0,0,0.1)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--gray3)', background: 'var(--bg)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--black)', marginBottom: 2 }}>{lead.name}</div>
              <div style={{ fontSize: 12, color: 'var(--gray2)', fontWeight: 500 }}>
                {lead.stage?.name} · {lead.responsibleName}
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray2)', fontSize: 18, lineHeight: 1 }}>✕</button>
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--green)', marginTop: 8 }}>
            {formatCurrency(lead.price)}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Priority */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--gray2)', marginBottom: 8 }}>Prioridade</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['high', 'normal', 'low'] as Priority[]).map(p => (
                <button key={p} onClick={() => setPriority(p)} style={{
                  padding: '6px 12px', borderRadius: 100, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  fontFamily: 'inherit', border: '1px solid',
                  borderColor: priority === p ? PRIORITY_LABELS[p].color : 'var(--gray3)',
                  background: priority === p ? PRIORITY_LABELS[p].bg : 'var(--white)',
                  color: priority === p ? PRIORITY_LABELS[p].color : 'var(--gray)',
                  transition: 'all .15s',
                }}>
                  {PRIORITY_LABELS[p].label}
                </button>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--gray2)', marginBottom: 8 }}>Tags</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {tags.map(tag => (
                <span key={tag} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '3px 10px', borderRadius: 100, fontSize: 12, fontWeight: 700,
                  background: 'var(--primary-dim)', border: '1px solid var(--primary-mid)', color: 'var(--primary-text)',
                }}>
                  {tag}
                  <button onClick={() => setTags(tags.filter(t => t !== tag))}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary-text)', lineHeight: 1, padding: 0, fontSize: 12 }}>✕</button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={newTag}
                onChange={e => setNewTag(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addTag()}
                placeholder="Nova tag…"
                style={{
                  flex: 1, padding: '8px 12px', fontSize: 13, fontFamily: 'inherit', fontWeight: 500,
                  border: '1px solid var(--gray3)', borderRadius: 8, outline: 'none', background: 'var(--white)', color: 'var(--black)',
                }}
                onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 3px var(--primary-dim)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--gray3)'; e.target.style.boxShadow = 'none' }}
              />
              <button onClick={addTag} style={{
                padding: '8px 14px', fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
                background: 'var(--primary)', border: 'none', borderRadius: 8, cursor: 'pointer',
                color: 'var(--primary-contrast)',
              }}>+</button>
            </div>
          </div>

          {/* Notes */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--gray2)', marginBottom: 8 }}>Notas internas</div>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={5}
              placeholder="Observações sobre este lead…"
              style={{
                width: '100%', padding: '10px 14px', fontSize: 13, fontFamily: 'inherit', fontWeight: 500,
                border: '1px solid var(--gray3)', borderRadius: 8, outline: 'none', resize: 'none',
                background: 'var(--white)', color: 'var(--black)', lineHeight: 1.5,
              }}
              onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 3px var(--primary-dim)' }}
              onBlur={e => { e.target.style.borderColor = 'var(--gray3)'; e.target.style.boxShadow = 'none' }}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--gray3)', background: 'var(--bg)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{
            padding: '9px 20px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
            background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 100, cursor: 'pointer',
            color: 'var(--gray)',
          }}>Cancelar</button>
          <button onClick={save} disabled={saving} style={{
            padding: '9px 20px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
            background: 'var(--primary)', border: 'none', borderRadius: 100, cursor: 'pointer',
            color: 'var(--primary-contrast)',
          }}>{saving ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  )
}

export default function PipelinePage() {
  const qc = useQueryClient()
  const [selectedLead, setSelectedLead] = useState<any>(null)
  const [search, setSearch] = useState('')
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const [showNoTags, setShowNoTags] = useState(false)
  const [draggingLeadId, setDraggingLeadId] = useState<string | null>(null)
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null)

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ['leads'],
    queryFn: () => fetch('/api/leads').then(r => r.json()),
  })

  const saveMutation = useMutation({
    mutationFn: ({ leadId, data }: { leadId: string; data: any }) =>
      fetch(`/api/leads/${leadId}/extras`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  })

  const moveMutation = useMutation({
    mutationFn: ({ leadId, stageId }: { leadId: string; stageId: string }) =>
      fetch(`/api/leads/${leadId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stageId }),
      }),
    onMutate: ({ leadId, stageId }) => {
      qc.setQueryData(['leads'], (old: any[] = []) => {
        const stageRef = old.find((l: any) => l.stageId === stageId)?.stage
        return old.map((l: any) => l.id === leadId
          ? { ...l, stageId, stage: stageRef ?? { ...l.stage, id: stageId } }
          : l
        )
      })
    },
    onError: () => qc.invalidateQueries({ queryKey: ['leads'] }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  })

  // All unique tags across all leads (for the filter bar)
  const allTags = Array.from(
    new Set(leads.flatMap((l: any) => l.extras?.tags ?? []))
  ).sort() as string[]

  const isTagFiltered = selectedTags.size > 0 || showNoTags

  function toggleTag(tag: string) {
    setSelectedTags(prev => {
      const next = new Set(prev)
      next.has(tag) ? next.delete(tag) : next.add(tag)
      return next
    })
  }

  function clearFilters() {
    setSelectedTags(new Set())
    setShowNoTags(false)
  }

  // Group leads by stage
  const stageMap = new Map<string, { name: string; color: string; order: number; leads: any[] }>()
  for (const lead of leads) {
    if (!lead.stage) continue
    const q = search.toLowerCase()
    if (q && !lead.name.toLowerCase().includes(q)) continue
    // Tag filter
    if (isTagFiltered) {
      const leadTags: string[] = lead.extras?.tags ?? []
      const hasNoTags = leadTags.length === 0
      const matchesTag = selectedTags.size > 0 && leadTags.some(t => selectedTags.has(t))
      if (!matchesTag && !(showNoTags && hasNoTags)) continue
    }
    const existing = stageMap.get(lead.stageId)
    if (existing) {
      existing.leads.push(lead)
    } else {
      stageMap.set(lead.stageId, { name: lead.stage.name, color: lead.stage.color, order: lead.stage.order, leads: [lead] })
    }
  }
  const stageGroups = Array.from(stageMap.entries())
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([id, v]) => ({ id, ...v }))

  if (isLoading) {
    const sk = (w: string | number, h: number, r = 8) => (
      <div className="shimmer-bar" style={{ width: w, height: h, borderRadius: r, background: 'var(--gray3)', flexShrink: 0 }} />
    )
    return (
      <div style={{ animation: 'fadeIn .3s ease both' }}>
        {/* header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{sk(120, 22, 6)}{sk(200, 13, 4)}</div>
          {sk(180, 36, 8)}
        </div>
        {/* kanban columns */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 260px)', gap: 12 }}>
          {[0,1,2,3].map(col => (
            <div key={col} style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                {sk('55%', 12, 4)}{sk(24, 20, 100)}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[0,1,2].map(card => (
                  <div key={card} style={{ background: 'var(--bg)', border: '1px solid var(--gray3)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 9 }}>
                    {sk('80%', 13, 4)}{sk('50%', 11, 4)}
                    <div style={{ display: 'flex', gap: 6 }}>{sk(48, 18, 100)}{sk(56, 18, 100)}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>{sk(60, 11, 4)}{sk(50, 11, 4)}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="animate-slide-up delay-1" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.02em' }}>Pipeline</div>
          <div style={{ fontSize: 13, color: 'var(--gray)', marginTop: 2 }}>Espelho do seu CRM com campos extras</div>
        </div>
        <div style={{ position: 'relative' }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--gray2)" strokeWidth="1.5"
            style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
            <circle cx="6.5" cy="6.5" r="4.5"/><path d="M10.5 10.5L14 14"/>
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar lead…"
            style={{
              width: 220, padding: '9px 12px 9px 36px', fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
              color: 'var(--black)', background: 'var(--white)', border: '1px solid var(--gray3)',
              borderRadius: 100, outline: 'none', transition: 'border-color .2s',
            }}
            onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 3px var(--primary-dim)' }}
            onBlur={e => { e.target.style.borderColor = 'var(--gray3)'; e.target.style.boxShadow = 'none' }}
          />
        </div>
      </div>

      {/* Tag filters */}
      {allTags.length > 0 && (
        <div className="animate-slide-up delay-2" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>Tags:</span>

          {/* No-tags chip */}
          <button
            onClick={() => setShowNoTags(v => !v)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '4px 11px', borderRadius: 100, fontSize: 11, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
              background: showNoTags ? 'var(--black)' : 'var(--white)',
              color: showNoTags ? 'var(--white)' : 'var(--gray)',
              border: showNoTags ? '1px solid var(--black)' : '1px solid var(--gray3)',
              transition: 'all .15s ease',
            }}
          >
            <span style={{ opacity: 0.6 }}>∅</span> Sem tags
          </button>

          {allTags.map(tag => {
            const active = selectedTags.has(tag)
            return (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '4px 11px', borderRadius: 100, fontSize: 11, fontWeight: 700,
                  cursor: 'pointer', fontFamily: 'inherit',
                  background: active ? 'var(--primary)' : 'var(--primary-dim)',
                  color: active ? 'var(--primary-contrast)' : 'var(--primary-text)',
                  border: active ? '1px solid var(--primary)' : '1px solid var(--primary-mid)',
                  boxShadow: active ? '0 2px 6px rgba(255,180,0,0.25)' : 'none',
                  transition: 'all .15s ease',
                }}
              >
                {tag}
              </button>
            )
          })}

          {isTagFiltered && (
            <button
              onClick={clearFilters}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 100, fontSize: 11, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit',
                background: 'transparent', color: 'var(--gray2)',
                border: '1px solid transparent',
                transition: 'color .15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--gray2)')}
            >
              ✕ Limpar
            </button>
          )}
        </div>
      )}

      {/* Kanban board */}
      <div className={`animate-slide-up ${allTags.length > 0 ? 'delay-3' : 'delay-2'}`} style={{ overflowX: 'auto', paddingBottom: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${stageGroups.length || 1}, 260px)`, gap: 12, minWidth: 'fit-content' }}>
          {stageGroups.length === 0 ? (
            <div style={{ padding: 32, fontSize: 14, color: 'var(--gray2)', gridColumn: '1/-1', textAlign: 'center' }}>
              Nenhum lead encontrado. Conecte o Kommo na seção Integrações.
            </div>
          ) : stageGroups.map(stage => {
            const isDropTarget = dragOverStageId === stage.id && !!draggingLeadId
            return (
            <div
              key={stage.id}
              onDragOver={e => { e.preventDefault(); if (dragOverStageId !== stage.id) setDragOverStageId(stage.id) }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverStageId(null) }}
              onDrop={e => {
                e.preventDefault()
                const leadId = e.dataTransfer.getData('leadId')
                const lead = (leads as any[]).find(l => l.id === leadId)
                if (leadId && lead?.stageId !== stage.id) {
                  moveMutation.mutate({ leadId, stageId: stage.id })
                }
                setDraggingLeadId(null)
                setDragOverStageId(null)
              }}
              style={{
                borderRadius: 14,
                padding: isDropTarget ? 6 : 0,
                background: isDropTarget ? 'var(--primary-dim)' : 'transparent',
                border: isDropTarget ? '2px dashed var(--primary)' : '2px dashed transparent',
                transition: 'all .15s ease',
              }}
            >
              {/* Column header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, padding: isDropTarget ? '0 2px' : 0 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: stage.color, flexShrink: 0 }} />
                <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray2)' }}>
                  {stage.name}
                </div>
                <div style={{
                  marginLeft: 'auto', fontSize: 10, fontWeight: 800, padding: '1px 7px', borderRadius: 100,
                  background: 'var(--primary)', color: 'var(--primary-contrast)',
                }}>
                  {stage.leads.length}
                </div>
              </div>

              {/* Cards */}
              {stage.leads.map(lead => {
                const age = lead.updatedAt ? daysAgo(new Date(lead.updatedAt * 1000)) : 0
                const hasAlert = age > 7
                const isDragging = draggingLeadId === lead.id
                return (
                  <div key={lead.id}
                    draggable
                    onDragStart={e => {
                      setDraggingLeadId(lead.id)
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('leadId', lead.id)
                    }}
                    onDragEnd={() => { setDraggingLeadId(null); setDragOverStageId(null) }}
                    onClick={() => { if (!draggingLeadId) setSelectedLead(lead) }}
                    style={{
                      background: 'var(--white)', border: `1px solid ${hasAlert ? 'rgba(217,48,37,0.3)' : 'var(--gray3)'}`,
                      borderLeft: lead.extras?.priority === 'high' ? '3px solid var(--red)' : `1px solid ${hasAlert ? 'rgba(217,48,37,0.3)' : 'var(--gray3)'}`,
                      borderRadius: 12, padding: 12, marginBottom: 8,
                      boxShadow: 'var(--shadow)', transition: 'border-color .2s, opacity .15s, transform .15s',
                      cursor: isDragging ? 'grabbing' : 'grab',
                      opacity: isDragging ? 0.4 : 1,
                      transform: isDragging ? 'scale(0.97)' : 'scale(1)',
                      userSelect: 'none',
                    }}
                    onMouseEnter={e => { if (!isDragging) e.currentTarget.style.borderColor = 'var(--primary-mid)' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = hasAlert ? 'rgba(217,48,37,0.3)' : 'var(--gray3)' }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--black)', marginBottom: 4 }}>{lead.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 500, marginBottom: 8 }}>{lead.responsibleName}</div>
                    {lead.extras?.tags?.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                        {lead.extras.tags.slice(0, 3).map((tag: string) => (
                          <span key={tag} style={{
                            fontSize: 10, fontWeight: 700, padding: '1px 8px', borderRadius: 100,
                            background: 'var(--primary-dim)', border: '1px solid var(--primary-mid)', color: 'var(--primary-text)',
                          }}>{tag}</span>
                        ))}
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--green)' }}>{formatCurrency(lead.price)}</div>
                      <div style={{ fontSize: 10, color: hasAlert ? 'var(--red)' : 'var(--gray2)', fontWeight: 600 }}>
                        {age === 0 ? 'Hoje' : `${age}d`}
                      </div>
                    </div>
                  </div>
                )
              })}

              {/* Empty drop target indicator */}
              {isDropTarget && stage.leads.length === 0 && (
                <div style={{ height: 60, borderRadius: 10, border: '2px dashed var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--primary-text)', fontWeight: 700 }}>
                  Soltar aqui
                </div>
              )}
            </div>
          )})}

        </div>
      </div>

      {/* Lead extras panel */}
      {selectedLead && (
        <LeadExtrasPanel
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onSave={(data) => saveMutation.mutateAsync({ leadId: selectedLead.id, data })}
        />
      )}
    </div>
  )
}
