import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { assertEntitlement } from '@/lib/entitlements'
import { getProvider } from '@/lib/providers/registry'

const PROVIDER_KEY = 'ycloud-whatsapp'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const denied = await assertEntitlement(session.user.tenantId, 'integration.ycloud-whatsapp')
  if (denied) return denied

  const body = await req.json()
  const { apiKey, webhookSecret } = body as { apiKey?: string; webhookSecret?: string }

  if (!apiKey || typeof apiKey !== 'string') {
    return NextResponse.json({ valid: false, error: 'apiKey é obrigatório' })
  }
  if (!webhookSecret || typeof webhookSecret !== 'string') {
    return NextResponse.json({ valid: false, error: 'webhookSecret é obrigatório' })
  }

  const provider = getProvider(PROVIDER_KEY)
  if (!provider) {
    return NextResponse.json({ valid: false, error: 'Provider não encontrado' })
  }

  // O teste de conexão valida apenas a API key (chama o YCloud /balance).
  // fromPhone NÃO é necessário aqui — só é exigido ao salvar (parseConfig),
  // então não passamos pelo parseConfig estrito para não bloquear o teste.
  try {
    const result = await provider.testConnection({ apiKey, webhookSecret, fromPhone: '' })
    return NextResponse.json({ valid: result.ok, error: result.message })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ valid: false, error: msg })
  }
}
