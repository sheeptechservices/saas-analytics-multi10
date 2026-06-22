// GET /api/ycloud/conversations/{sessionId}
//
// Returns the full message thread for a WhatsApp session, plus the 24h window flag.
//
// Response:
// {
//   sessionId:      string,
//   contact:        { name: string | null; phone: string },
//   inWindow:       boolean,         -- true when free-form text is allowed
//   windowExpiresAt: number | null,  -- epoch ms = lastInbound + 24h (null if no inbound yet)
//   messages: [{
//     id:          string,            -- row id (tenantId:source:ycloudMsgId) — stable unique key
//     role:        'human'|'ai'|'system',
//     content:     string,
//     occurredAt:  number | null,     -- epoch ms
//     metadata:    Record<string, unknown>,
//   }],
// }
//
// Next.js 15: params is Promise<{ sessionId: string }> — must be awaited.
// occurredAt is mode:'timestamp' → Drizzle returns Date; .getTime() = epoch ms.
// Requires module 'integration.ycloud-whatsapp'.

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { conversations, contacts } from '@/lib/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { assertEntitlement } from '@/lib/entitlements'

const MODULE_KEY    = 'integration.ycloud-whatsapp'
const SOURCE        = 'ycloud-whatsapp'
const WINDOW_24H_MS = 24 * 60 * 60 * 1000

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

  // ── Fetch all messages for this session, oldest first (chat order) ────────

  const rows = await db
    .select({
      id:         conversations.id,
      role:       conversations.role,
      content:    conversations.content,
      occurredAt: conversations.occurredAt,
      metadata:   conversations.metadata,
    })
    .from(conversations)
    .where(and(
      eq(conversations.tenantId, tenantId),
      eq(conversations.source,   SOURCE),
      eq(conversations.sessionId, sessionId),
    ))
    .orderBy(asc(conversations.occurredAt))

  // ── 24h window — same logic as POST /api/ycloud/messages ─────────────────
  // Find the most recent inbound (role='human') from this session.
  // Drizzle returns occurredAt as Date; .getTime() = epoch ms.

  let lastInboundMs: number | null = null
  for (const row of rows) {
    if (row.role === 'human') {
      const ms = row.occurredAt instanceof Date ? row.occurredAt.getTime() : null
      if (ms !== null && (lastInboundMs === null || ms > lastInboundMs)) {
        lastInboundMs = ms
      }
    }
  }

  const inWindow       = lastInboundMs !== null && (Date.now() - lastInboundMs) <= WINDOW_24H_MS
  const windowExpiresAt = lastInboundMs !== null ? lastInboundMs + WINDOW_24H_MS : null

  // ── Contact lookup ────────────────────────────────────────────────────────
  // sessionId = E.164 phone = contacts.externalId for source='ycloud-whatsapp'

  const [contact] = await db
    .select({ name: contacts.name, phone: contacts.phone })
    .from(contacts)
    .where(and(
      eq(contacts.tenantId,   tenantId),
      eq(contacts.source,     SOURCE),
      eq(contacts.externalId, sessionId),
    ))
    .limit(1)

  // ── Shape messages ────────────────────────────────────────────────────────

  const messages = rows.map(r => ({
    id:         r.id,
    role:       r.role,
    content:    r.content,
    occurredAt: r.occurredAt instanceof Date ? r.occurredAt.getTime() : null,
    metadata:   parseJson(r.metadata),
  }))

  return NextResponse.json({
    sessionId,
    contact: {
      name:  contact?.name  ?? null,
      phone: contact?.phone ?? sessionId,  // sessionId is E.164 — safe fallback
    },
    inWindow,
    windowExpiresAt,
    messages,
  })
}

function parseJson(s: string): Record<string, unknown> {
  try { return JSON.parse(s) as Record<string, unknown> } catch { return {} }
}
