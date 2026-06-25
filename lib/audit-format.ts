export const ACTION_LABELS: Record<string, string> = {
  'disparo.manual':    'Disparo manual',
  'disparo.campanha':  'Disparo (campanha)',
  'enroll':            'Adição à campanha',
  'settings.update':   'Alterou configurações',
  'leads.import':      'Importou leads',
  'user.create':       'Criou usuário',
  'user.update':       'Editou usuário',
  'user.delete':       'Removeu usuário',
  'whitelabel.update': 'Alterou marca',
}

export function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return '—' }
}

export function fmtDetail(action: string, entityType: string | null, entityId: string | null, meta: Record<string, unknown>): string {
  const parts: string[] = []
  if (entityId) parts.push(`#${String(entityId).slice(0, 8)}`)
  switch (action) {
    case 'disparo.manual':
      if (meta.template) parts.push(`tmpl: ${meta.template}`)
      if (meta.totalSolicitado !== undefined) parts.push(`${meta.totalSolicitado} leads`)
      if (meta.skipped) parts.push(`${meta.skipped} pulados`)
      break
    case 'disparo.campanha':
      parts.push(`limite: ${meta.limiteDiario ?? '—'}`)
      break
    case 'enroll':
      if (meta.leadCount !== undefined) parts.push(`${meta.leadCount} leads`)
      if (meta.fase) parts.push(String(meta.fase))
      break
    case 'settings.update':
      if (Array.isArray(meta.changedKeys) && meta.changedKeys.length) parts.push(meta.changedKeys.join(', '))
      if (meta.status) parts.push(String(meta.status))
      break
    case 'leads.import':
      if (meta.inserted !== undefined) parts.push(`${meta.inserted} novos`)
      if (meta.updated !== undefined) parts.push(`${meta.updated} atualizados`)
      if (meta.skipped !== undefined) parts.push(`${meta.skipped} pulados`)
      break
    case 'user.create':
      if (meta.email) parts.push(String(meta.email))
      if (meta.role) parts.push(String(meta.role))
      break
    case 'user.update': {
      const ch = meta.changes as Record<string, unknown> | undefined
      if (ch && typeof ch === 'object') {
        const pairs = Object.entries(ch).map(([k, v]) => `${k}: ${v}`).join(', ')
        if (pairs) parts.push(pairs)
      }
      break
    }
    case 'whitelabel.update':
      if (Array.isArray(meta.changedKeys) && meta.changedKeys.length) parts.push(meta.changedKeys.join(', '))
      break
  }
  return parts.join(' · ') || '—'
}
