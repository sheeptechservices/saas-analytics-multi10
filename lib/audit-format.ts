export const ACTION_LABELS: Record<string, string> = {
  'disparo.manual':    'Disparo manual',
  'disparo.campanha':  'Disparo (campanha)',
  'enroll':            'Adição à campanha',
  'settings.update':   'Alterou configurações',
  'leads.import':      'Importou leads',
  // O outro caminho que insere lead (/api/sdr/leads/manual), um de cada vez.
  'leads.manual':      'Cadastrou lead',
  'user.create':       'Criou usuário',
  'user.update':       'Editou usuário',
  'user.delete':       'Removeu usuário',
  // Só a própria senha: não existe caminho para trocar a de outra pessoa.
  'user.password.change': 'Alterou a própria senha',
  'whitelabel.update': 'Alterou marca',
  // Só o master cria cliente: aparece na auditoria do master, não na do tenant —
  // mas o filtro e o rótulo são os mesmos nas duas telas, então mora aqui.
  'tenant.create':     'Criou cliente',
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
    // A rota grava o mesmo `metadata` de leads.import, mas aqui é sempre um lead: o
    // caminho que não escreveu sai antes dela (409), então `inserted` é 1 em toda
    // linha e repeti-lo não informa nada — quem identifica o registro é o id, já no
    // prefixo. Os outros dois só saem se algum dia vierem diferentes de zero.
    case 'leads.manual':
      if (meta.updated) parts.push(`${meta.updated} atualizados`)
      if (meta.skipped) parts.push(`${meta.skipped} pulados`)
      break
    case 'tenant.create':
      if (meta.name) parts.push(String(meta.name))
      if (meta.slug) parts.push(String(meta.slug))
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
