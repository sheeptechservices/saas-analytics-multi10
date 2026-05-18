import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { aiSettings, aiUsageLogs } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'
import { randomUUID } from 'crypto'

const SYSTEM_PROMPT = `Você é o assistente de BI da plataforma Multi10 — uma plataforma de funil de vendas com integração ao Kommo CRM.

Você pode ajudar com:
- **Análise de dados**: interpretar métricas do pipeline (leads, conversão, ticket médio, etapas do funil)
- **Como usar o sistema**: onde encontrar funcionalidades, como navegar pelo Dashboard, Pipeline Kanban, Integração Kommo e Configurações
- **Integração Kommo**: como conectar a conta, o que é sincronizado (leads, etapas, responsáveis), resolução de problemas
- **Configurações**: white-label (cor primária, logo, nome da marca), gerenciamento de equipe

Guia rápido do sistema:
- **Dashboard**: visão geral do funil — KPI cards (total leads, conversão, ticket médio), funil por etapa, gráfico semanal, maiores oportunidades
- **Pipeline**: quadro Kanban com as etapas do funil; clique num lead para ver detalhes e enriquecer com tags/notas
- **Kommo CRM**: página de integração com stepper de 3 passos — autorizar OAuth, sincronizar dados, verificar status
- **Configurações**: personalizar cor primária e logo da plataforma; visualizar membros da equipe

Seja conciso e direto. Use markdown quando útil (listas, negrito). Responda sempre em português brasileiro.`

const ALLOWED_MODELS = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-7'] as const
type AllowedModel = typeof ALLOWED_MODELS[number]

const COST_PER_M: Record<AllowedModel, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 0.80,  output: 4.00  },
  'claude-sonnet-4-6':         { input: 3.00,  output: 15.00 },
  'claude-opus-4-7':           { input: 15.00, output: 75.00 },
}

let fxRate = 0
let fxExpiry = 0

async function getUsdBrlRate(): Promise<number> {
  if (Date.now() < fxExpiry && fxRate > 0) return fxRate
  try {
    const res = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL', {
      signal: AbortSignal.timeout(5000),
    })
    const data = await res.json()
    const parsed = parseFloat((data as any).USDBRL?.bid ?? '0')
    if (parsed > 0) fxRate = parsed
  } catch {}
  if (!fxRate) fxRate = 6.0
  fxExpiry = Date.now() + 60 * 60 * 1000
  return fxRate
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const settings = await db.select().from(aiSettings)
    .where(eq(aiSettings.tenantId, session.user.tenantId))
    .then(r => r[0])

  if (!settings || !settings.apiKeyEnc || settings.isActive === 0) {
    return NextResponse.json({ error: 'ai_not_configured' }, { status: 402 })
  }

  const currentMonth = new Date().toISOString().slice(0, 7)
  if (settings.budgetMonth !== currentMonth) {
    await db.update(aiSettings).set({
      cachedSpendUsd: 0,
      budgetMonth: currentMonth,
      updatedAt: Date.now(),
    }).where(eq(aiSettings.tenantId, session.user.tenantId))
    settings.cachedSpendUsd = 0
  }

  if (settings.monthlyBudgetBrl && settings.monthlyBudgetBrl > 0) {
    const rate = await getUsdBrlRate()
    if ((settings.cachedSpendUsd ?? 0) * rate >= settings.monthlyBudgetBrl) {
      return NextResponse.json({ error: 'budget_exceeded' }, { status: 402 })
    }
  }

  const { messages, context, model: reqModel } = await req.json()
  const model: AllowedModel = ALLOWED_MODELS.includes(reqModel) ? reqModel : 'claude-haiku-4-5-20251001'

  const client = new Anthropic({ apiKey: decrypt(settings.apiKeyEnc) })

  let systemPrompt = SYSTEM_PROMPT
  if (context?.metrics) {
    const m = context.metrics
    systemPrompt += `\n\n---\n**Dados atuais do pipeline (${new Date().toLocaleDateString('pt-BR')}):**\n`
    systemPrompt += `- Total de leads no pipeline: ${m.totalLeads}\n`
    systemPrompt += `- Leads criados esta semana: ${m.leadsThisWeek}\n`
    systemPrompt += `- Taxa de conversão: ${m.conversionRate}%\n`
    systemPrompt += `- Ticket médio (negócios ganhos): R$ ${m.averageTicket?.toLocaleString('pt-BR') ?? 0}\n`
    systemPrompt += `- Leads fechados como ganho: ${m.closedLeads}\n`
    if (m.leadsByStage?.length) {
      systemPrompt += `- Distribuição por etapa: ${m.leadsByStage.map((s: any) => `${s.stageName} (${s.count} leads)`).join(' → ')}\n`
    }
    if (m.leadsByStatus?.length) {
      systemPrompt += `- Por status: ${m.leadsByStatus.map((s: any) => `${s.label}: ${s.count}`).join(', ')}\n`
    }
  }

  const stream = await client.messages.stream({
    model,
    max_tokens: 1024,
    system: systemPrompt,
    messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
  })

  const tenantId = session.user.tenantId
  const spendBase = settings.cachedSpendUsd ?? 0

  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          controller.enqueue(new TextEncoder().encode(chunk.delta.text))
        }
      }

      try {
        const { usage } = await stream.finalMessage()
        const rates = COST_PER_M[model]
        const costUsd = (usage.input_tokens / 1_000_000) * rates.input
          + (usage.output_tokens / 1_000_000) * rates.output
        const now = Date.now()

        await Promise.all([
          db.insert(aiUsageLogs).values({
            id: randomUUID(),
            tenantId,
            model,
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            costUsd,
            feature: 'chat',
            createdAt: now,
          }),
          db.update(aiSettings).set({
            cachedSpendUsd: spendBase + costUsd,
            updatedAt: now,
          }).where(eq(aiSettings.tenantId, tenantId)),
        ])
      } catch {}

      controller.close()
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
    },
  })
}
