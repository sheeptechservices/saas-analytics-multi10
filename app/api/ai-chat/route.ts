import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

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

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY não configurada. Adicione sua chave em .env.local para usar o assistente.' },
      { status: 503 }
    )
  }

  const { messages, context } = await req.json()

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
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: systemPrompt,
    messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
  })

  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          controller.enqueue(new TextEncoder().encode(chunk.delta.text))
        }
      }
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
