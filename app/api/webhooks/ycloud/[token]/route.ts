import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dataSources } from '@/lib/db/schema'
import { decrypt } from '@/lib/crypto'
import { normalizeWebhookEvent } from '@/lib/providers/ycloud'
import { upsertBatch } from '@/lib/sync/runner'

export const dynamic = 'force-dynamic'

const PROVIDER_KEY = 'ycloud-whatsapp'

// ─── Signature helpers ────────────────────────────────────────────────────────

/**
 * Parses the YCloud-Signature header.
 * Expected format: "t={unix_timestamp},s={hmac_hex}"
 */
function parseSignatureHeader(header: string): { t: string; s: string } | null {
  const tMatch = /t=([^,]+)/.exec(header)
  const sMatch = /s=([^,\s]+)/.exec(header)
  if (!tMatch || !sMatch) return null
  return { t: tMatch[1], s: sMatch[1] }
}

/**
 * Verifies HMAC-SHA256 of "{timestamp}.{rawBody}" against the received hex signature.
 * Uses timingSafeEqual to prevent timing attacks.
 *
 * Size check before timingSafeEqual is mandatory: timingSafeEqual throws if the two
 * buffers have different lengths, which would produce a 500 on malformed input.
 */
function verifySignature(rawBody: string, sigHex: string, timestamp: string, secret: string): boolean {
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')
  // Compare hex strings as UTF-8 buffers — avoids hex-decode ambiguity and keeps constant time.
  if (expected.length !== sigHex.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(sigHex, 'utf8'))
  } catch {
    return false
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  // Read raw body as text before any parsing — HMAC must be verified over the
  // exact bytes YCloud sent, not a re-serialised JSON object.
  const rawBody = await req.text()

  // ── 1. Resolve tenant by webhook token ──────────────────────────────────────
  const ds = await db
    .select()
    .from(dataSources)
    .where(
      and(
        eq(dataSources.webhookToken, token),
        eq(dataSources.providerKey, PROVIDER_KEY),
      )
    )
    .then(r => r[0])

  if (!ds?.configEnc) {
    // Return 404 with no detail to avoid confirming which tokens exist.
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // ── 2. Decrypt config to obtain webhookSecret ────────────────────────────────
  let webhookSecret: string
  try {
    const cfg = JSON.parse(decrypt(ds.configEnc)) as { webhookSecret?: string }
    if (!cfg.webhookSecret) throw new Error('missing webhookSecret in config')
    webhookSecret = cfg.webhookSecret
  } catch (err) {
    console.error('[ycloud webhook] config decrypt error', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  // ── 3. Verify YCloud-Signature ───────────────────────────────────────────────
  //
  // Timestamp window decision: YCloud's retry schedule is 10s→30s→5m→30m→1h→2h→2h
  // (up to ~6h total). The docs do NOT state that retries are re-signed with a new
  // timestamp — they may reuse the original. A strict 5-minute window would silently
  // drop every retry beyond the first. We intentionally skip timestamp-age rejection:
  // the HMAC alone is the authenticity gate, and upsertBatch idempotency (deterministic
  // sourceId) already neutralises replay of the same valid event.
  //
  // The entire block is wrapped in try/catch so that any unexpected error from header
  // parsing or buffer operations returns 401, never 500.
  try {
    const sigHeader = req.headers.get('YCloud-Signature')
    if (!sigHeader) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
    }

    const parsed = parseSignatureHeader(sigHeader)
    if (!parsed) {
      return NextResponse.json({ error: 'Malformed signature header' }, { status: 401 })
    }

    if (!verifySignature(rawBody, parsed.s, parsed.t, webhookSecret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  } catch {
    return NextResponse.json({ error: 'Signature verification failed' }, { status: 401 })
  }

  // ── 4. Parse, normalize, persist ────────────────────────────────────────────
  let event: unknown
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const batch = normalizeWebhookEvent(event, { tenantId: ds.tenantId })

  try {
    await upsertBatch(batch, ds.tenantId, ds.id, PROVIDER_KEY)
  } catch (err) {
    console.error(`[ycloud webhook] upsert failed tenant=${ds.tenantId} source=${ds.id}`, err)
    // Return 500 so YCloud retries; upsert is idempotent so retries are safe.
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
