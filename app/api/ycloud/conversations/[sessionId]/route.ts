// GET /api/ycloud/conversations/{sessionId}
//
// Returns the merged message thread: YCloud (human inbound + manual AI sends)
// merged with Turso-synced n8n messages (bot responses, source='supabase-n8n').
//
// Phone variants: sessionId is E.164 (+55...). n8n stores the phone without '+'
// and may toggle the Brazilian 9th-digit mobile prefix. We build all plausible
// variants and query WHERE sessionId IN (candidates).
//
// Dedup: human messages from both sources within 120 s of each other are
// collapsed into one (prefer YCloud for raw text; strip n8n context prefix).
//
// origin field: 'ycloud' | 'n8n' — passed to UI for optional source badge.
//
// Next.js 15: params is Promise<{ sessionId: string }> — must be awaited.
// occurredAt is mode:'timestamp' → Drizzle returns Date; .getTime() = epoch ms.
// Requires module 'integration.ycloud-whatsapp'.

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { conversations, contacts } from '@/lib/db/schema'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { assertEntitlement } from '@/lib/entitlements'

const MODULE_KEY    = 'integration.ycloud-whatsapp'
const YCLOUD        = 'ycloud-whatsapp'
const N8N           = 'supabase-n8n'
const WINDOW_24H_MS = 24 * 60 * 60 * 1000
const DEDUP_WINDOW  = 120_000   // ms — human messages within this window are the same inbound

// Build all plausible sessionId variants for the same contact.
// YCloud uses E.164 with '+'; n8n may omit '+' and/or toggle the BR 9th-digit.
function phoneVariants(e164: string): string[] {
  const digits = e164.replace(/^\+/, '')
  const out    = new Set<string>()

  function add(d: string) { out.add(d); out.add('+' + d) }

  add(digits)

  // Brazilian 9th-digit toggle: country code 55 + DDD(2) + local(8 or 9 digits)
  if (digits.startsWith('55')) {
    const nat = digits.slice(2)         // national part (10 or 11 digits)
    if (nat.length === 11 && nat[2] === '9') {
      // Remove 9th-digit (position 2 of national = DDD[0..1] + '9' + rest)
      add('55' + nat.slice(0, 2) + nat.slice(3))
    } else if (nat.length === 10) {
      // Add 9th-digit
      add('55' + nat.slice(0, 2) + '9' + nat.slice(2))
    }
  }

  return Array.from(out)
}

// Remove n8n context prefixes from human message content (best-effort).
// n8n prepends "Usuario: <name>\n" (or similar "<Word>: <text>\n") before
// the actual user text so the LLM knows who is speaking.
function stripContextPrefix(content: string): string {
  // Match a single-word label like "Usuario:" or "User:" at the very start
  // followed by arbitrary text and a newline, then strip that first line.
  return content.replace(/^[A-Za-záàãâéèêíïóõôúüçÀ-ÿ]+:\s*.+\n/, '').trim()
}

function parseJson(s: string): Record<string, unknown> {
  try { return JSON.parse(s) as Record<string, unknown> } catch { return {} }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId } = session.user
  const denied = await assertEntitlement(tenantId, MODULE_KEY)
  if (denied) return denied

  const { sessionId } = await params

  // ── Build phone variants ──────────────────────────────────────────────────
  const candidates = phoneVariants(sessionId)

  // ── Fetch messages from both sources in a single query ───────────────────
  // Turso is the only DB queried; no Supabase access.
  const rows = await db
    .select({
      id:         conversations.id,
      source:     conversations.source,
      role:       conversations.role,
      content:    conversations.content,
      occurredAt: conversations.occurredAt,
      metadata:   conversations.metadata,
    })
    .from(conversations)
    .where(and(
      eq(conversations.tenantId, tenantId),
      inArray(conversations.source,    [YCLOUD, N8N]),
      inArray(conversations.sessionId, candidates),
    ))
    .orderBy(asc(conversations.occurredAt))

  // ── Normalise rows ────────────────────────────────────────────────────────
  type Origin = 'ycloud' | 'n8n'
  type MsgRole = 'human' | 'ai' | 'system'

  type NormMsg = {
    id:         string
    role:       MsgRole
    content:    string
    occurredAt: number | null
    metadata:   Record<string, unknown>
    origin:     Origin
  }

  const normalized: NormMsg[] = rows.map(r => {
    const origin  = r.source === YCLOUD ? 'ycloud' : 'n8n'
    const content = origin === 'n8n' && r.role === 'human'
      ? stripContextPrefix(r.content)
      : r.content
    return {
      id:         r.id,
      role:       r.role as MsgRole,
      content,
      occurredAt: r.occurredAt instanceof Date ? r.occurredAt.getTime() : null,
      metadata:   parseJson(r.metadata),
      origin,
    }
  })

  // ── Dedup human messages across sources ───────────────────────────────────
  // A human message logged by YCloud and another logged by n8n within
  // DEDUP_WINDOW ms are the same inbound — drop the n8n copy.
  const ycloudHuman = normalized.filter(m => m.origin === 'ycloud' && m.role === 'human')

  const deduped = normalized.filter(m => {
    if (m.origin !== 'n8n' || m.role !== 'human') return true
    if (m.occurredAt === null) return true
    const isDuplicate = ycloudHuman.some(y =>
      y.occurredAt !== null && Math.abs(y.occurredAt - m.occurredAt!) <= DEDUP_WINDOW,
    )
    return !isDuplicate
  })

  // Sort ascending by occurredAt (nulls last)
  deduped.sort((a, b) => (a.occurredAt ?? Infinity) - (b.occurredAt ?? Infinity))

  // ── 24h window — based on last human inbound from any source ─────────────
  let lastInboundMs: number | null = null
  for (const m of deduped) {
    if (m.role === 'human' && m.occurredAt !== null) {
      if (lastInboundMs === null || m.occurredAt > lastInboundMs) {
        lastInboundMs = m.occurredAt
      }
    }
  }

  const inWindow        = lastInboundMs !== null && (Date.now() - lastInboundMs) <= WINDOW_24H_MS
  const windowExpiresAt = lastInboundMs !== null ? lastInboundMs + WINDOW_24H_MS : null

  // ── Contact lookup (YCloud contacts; externalId = E.164 sessionId) ────────
  const [contact] = await db
    .select({ name: contacts.name, phone: contacts.phone })
    .from(contacts)
    .where(and(
      eq(contacts.tenantId,   tenantId),
      eq(contacts.source,     YCLOUD),
      eq(contacts.externalId, sessionId),
    ))
    .limit(1)

  return NextResponse.json({
    sessionId,
    contact: {
      name:  contact?.name  ?? null,
      phone: contact?.phone ?? sessionId,
    },
    inWindow,
    windowExpiresAt,
    messages: deduped.map(m => ({
      id:         m.id,
      role:       m.role,
      content:    m.content,
      occurredAt: m.occurredAt,
      metadata:   m.metadata,
      origin:     m.origin,
    })),
  })
}
