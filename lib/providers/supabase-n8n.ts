import { Client } from 'pg'
import type {
  DataSourceProvider,
  FetchPage,
  SyncContext,
  CanonicalBatch,
  CanonicalFunnelStage,
  CanonicalEvent,
  CanonicalConversation,
  SyncCursor,
} from './types'

interface Config {
  connectionString: string
}

type StageKey = 'leads' | 'contacted' | 'responses' | 'meetings' | 'proposals' | 'closures'

interface FunnelRow {
  month: string | Date
  total_leads: number
  contacted_count: number
  response_count: number
  meeting_count: number
  proposal_count: number
  closed_count: number
}

interface LeadLogRow {
  id: unknown
  lead_id: string | null
  tipo_interacao: string | null
  mensagem_input: string | null
  mensagem_output: string | null
  sentimento: 'positivo' | 'neutro' | 'negativo' | null
  ocorreu_em: string | Date | null
  criado_em: string | Date
}

interface ChatRow {
  id: number
  session_id: string
  message: { type: 'human' | 'ai'; content: string }
}

interface SupabaseN8nRaw {
  funnel: FunnelRow[]
  leadLogs: LeadLogRow[]
  chats: ChatRow[]
}

const STAGE_KEYS: StageKey[] = ['leads', 'contacted', 'responses', 'meetings', 'proposals', 'closures']

const STAGE_NAMES: Record<StageKey, string> = {
  leads: 'Leads',
  contacted: 'Contactados',
  responses: 'Respostas',
  meetings: 'Reuniões',
  proposals: 'Propostas',
  closures: 'Fechamentos',
}

// funnel_metrics.month é "timestamp with time zone" (pg retorna Date, meia-noite UTC do
// dia 1 do mês). O dashboard filtra funnel_snapshots.period como string 'YYYY-MM', então
// convertemos em UTC para casar com os rótulos mensais da origem.
function toYearMonthUTC(v: string | Date): string {
  const d = v instanceof Date ? v : new Date(v)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function assertNotPrivateHost(connectionString: string): void {
  let url: URL
  try {
    url = new URL(connectionString)
  } catch {
    throw new Error('connectionString inválido: URL malformada')
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')

  if (hostname === 'localhost' || hostname === '::1') {
    throw new Error('connectionString aponta para host privado/local (SSRF bloqueado)')
  }

  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const a = Number(ipv4[1])
    const b = Number(ipv4[2])
    if (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    ) {
      throw new Error('connectionString aponta para IP privado (SSRF bloqueado)')
    }
  }
}

export const supabaseN8nProvider: DataSourceProvider<Config, SupabaseN8nRaw> = {
  key: 'supabase-n8n',
  label: 'Supabase / n8n (SDR)',

  parseConfig(raw: unknown): Config {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Config inválida: deve ser um objeto')
    }
    const r = raw as Record<string, unknown>
    if (!r.connectionString || typeof r.connectionString !== 'string') {
      throw new Error('Config inválida: connectionString é obrigatório')
    }
    assertNotPrivateHost(r.connectionString)
    return { connectionString: r.connectionString }
  },

  async testConnection(cfg: Config): Promise<{ ok: boolean; message?: string }> {
    const client = new Client({ connectionString: cfg.connectionString })
    try {
      await client.connect()
      await client.query('SELECT 1')
      return { ok: true }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, message: msg }
    } finally {
      await client.end().catch(() => {})
    }
  },

  async fetch(cfg: Config, ctx: SyncContext): Promise<FetchPage<SupabaseN8nRaw>> {
    const raw = ctx.cursor as Record<string, string | number | null> | null
    const leadLogsAfter =
      typeof raw?.leadLogsAfter === 'string' ? raw.leadLogsAfter : '1970-01-01T00:00:00.000Z'
    const chatAfterId = typeof raw?.chatAfterId === 'number' ? raw.chatAfterId : 0
    const funnelDone = Boolean(raw?.funnelDone)

    const N = 500
    const client = new Client({ connectionString: cfg.connectionString })
    await client.connect()

    try {
      let funnel: FunnelRow[] = []
      if (!funnelDone) {
        const res = await client.query<FunnelRow>('SELECT * FROM funnel_metrics')
        funnel = res.rows
      }

      const { rows: leadLogs } = await client.query<LeadLogRow>(
        'SELECT * FROM lead_logs WHERE criado_em > $1 ORDER BY criado_em ASC LIMIT $2',
        [leadLogsAfter, N]
      )

      const { rows: chats } = await client.query<ChatRow>(
        'SELECT * FROM n8n_chat_histories WHERE id > $1 ORDER BY id ASC LIMIT $2',
        [chatAfterId, N]
      )

      const lastLead = leadLogs.at(-1)
      const lastChat = chats.at(-1)

      const nextCursor: SyncCursor = {
        funnelDone: 1,
        leadLogsAfter: lastLead ? new Date(lastLead.criado_em).toISOString() : leadLogsAfter,
        chatAfterId: lastChat ? lastChat.id : chatAfterId,
      }

      return {
        raw: { funnel, leadLogs, chats },
        nextCursor,
        done: leadLogs.length < N && chats.length < N,
      }
    } finally {
      await client.end().catch(() => {})
    }
  },

  normalize(raw: SupabaseN8nRaw, _ctx: SyncContext): CanonicalBatch {
    type ColKey = 'total_leads' | 'contacted_count' | 'response_count' | 'meeting_count' | 'proposal_count' | 'closed_count'
    const STAGE_COL_MAP: Array<{ col: ColKey; key: StageKey }> = [
      { col: 'total_leads',     key: 'leads'     },
      { col: 'contacted_count', key: 'contacted' },
      { col: 'response_count',  key: 'responses' },
      { col: 'meeting_count',   key: 'meetings'  },
      { col: 'proposal_count',  key: 'proposals' },
      { col: 'closed_count',    key: 'closures'  },
    ]

    const funnel: CanonicalFunnelStage[] = raw.funnel.flatMap(row =>
      STAGE_COL_MAP.map(({ col, key }, idx) => ({
        period: toYearMonthUTC(row.month),
        stageKey: key,
        stageName: STAGE_NAMES[key],
        count: Number(row[col]) || 0,
        order: idx,
      }))
    )

    const sentimentMap: Record<string, 'positive' | 'neutral' | 'negative'> = {
      positivo: 'positive',
      neutro:   'neutral',
      negativo: 'negative',
    }

    const events: CanonicalEvent[] = raw.leadLogs.map(row => ({
      sourceId:   String(row.id),
      eventType:  row.tipo_interacao ?? 'interaction',
      entityId:   row.lead_id ?? undefined,
      occurredAt: new Date(row.ocorreu_em ?? row.criado_em).getTime(),
      sentiment:  (row.sentimento ? sentimentMap[row.sentimento] : null) ?? null,
      payload: {
        input:  row.mensagem_input,
        output: row.mensagem_output,
      },
    }))

    const conversations: CanonicalConversation[] = raw.chats.map(row => ({
      sourceId: String(row.id),
      sessionId: row.session_id,
      role: row.message?.type === 'ai' ? 'ai' : 'human',
      content: row.message?.content ?? '',
      // n8n_chat_histories não tem coluna de timestamp; guardamos o id sequencial
      // do chat como proxy de recência para ordenar as "sessões recentes".
      metadata: { chatId: typeof row.id === 'number' ? row.id : Number(row.id) || 0 },
    }))

    return { funnel, events, conversations }
  },
}
