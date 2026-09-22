import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { aiSettings, aiUsageLogs } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'
import { randomUUID } from 'crypto'
import { assertEntitlement } from '@/lib/entitlements'

const SYSTEM_PROMPT = `Você é o assistente da plataforma 300 Franchising — uma plataforma de SDR com IA que reúne as conversas de WhatsApp, os disparos de campanha e as métricas do funil de prospecção.

Você pode ajudar com:
- **Como usar o sistema**: onde encontrar funcionalidades e como navegar entre Dashboard, Conversas, Disparos e Configurações
- **Interpretação de métricas**: o que significam as etapas do funil, as taxas de conversão e como melhorá-las
- **Integrações**: fonte de dados SDR, WhatsApp (YCloud), Google/Meta/TikTok Ads e a própria IA
- **Configurações**: perfil, marca (cor primária, logo, nome), equipe e parâmetros da campanha SDR

Guia rápido do sistema:
- **Dashboard**: visão geral do funil de prospecção por período, com as etapas e a taxa entre elas; a aba Marketing mostra as campanhas de anúncios
- **Conversas**: as conversas de WhatsApp com os leads e a lista de contatos
- **Disparos**: novo disparo de mensagens para uma lista de leads e o histórico dos disparos, com a entrega de cada um
- **Configurações**: integrações, campanha SDR, equipe, perfil, marca e auditoria

Você não recebe os dados do cliente nesta conversa: só analise números que o usuário informar na mensagem. Se pedirem um número que não foi informado, diga onde encontrá-lo no sistema em vez de estimar.

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

  const denied = await assertEntitlement(session.user.tenantId, 'integration.ai')
  if (denied) return denied

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

  const { messages, model: reqModel } = await req.json()
  const model: AllowedModel = ALLOWED_MODELS.includes(reqModel) ? reqModel : 'claude-haiku-4-5-20251001'

  const client = new Anthropic({ apiKey: decrypt(settings.apiKeyEnc) })

  const stream = await client.messages.stream({
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
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
