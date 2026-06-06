import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { assertEntitlement } from '@/lib/entitlements'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const denied = await assertEntitlement(session.user.tenantId, 'integration.ai')
  if (denied) return denied

  const { apiKey } = await req.json()
  if (!apiKey) return NextResponse.json({ valid: false, error: 'API key não fornecida' })

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    })

    if (res.ok) return NextResponse.json({ valid: true })

    const data = await res.json().catch(() => ({}))
    const error = (data as any)?.error?.message ?? `HTTP ${res.status}`
    return NextResponse.json({ valid: false, error })
  } catch {
    return NextResponse.json({ valid: false, error: 'Falha na conexão com a Anthropic' })
  }
}
