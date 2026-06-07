import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { assertEntitlement } from '@/lib/entitlements'
import { getProvider } from '@/lib/providers/registry'

const PROVIDER_KEY = 'supabase-n8n'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const denied = await assertEntitlement(session.user.tenantId, 'integration.sdr-source')
  if (denied) return denied

  const body = await req.json()
  const { connectionString } = body as { connectionString?: string }

  if (!connectionString || typeof connectionString !== 'string') {
    return NextResponse.json({ valid: false, error: 'connectionString é obrigatório' })
  }

  const provider = getProvider(PROVIDER_KEY)
  if (!provider) {
    return NextResponse.json({ valid: false, error: 'Provider não encontrado' })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cfg: any
  try {
    cfg = provider.parseConfig({ connectionString })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ valid: false, error: msg })
  }

  try {
    const result = await provider.testConnection(cfg)
    return NextResponse.json({ valid: result.ok, error: result.message })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ valid: false, error: msg })
  }
}
