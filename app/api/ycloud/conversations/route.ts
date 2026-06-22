// GET /api/ycloud/conversations?page=1&limit=20
//
// Lists WhatsApp conversation sessions for the tenant, one row per sessionId.
// Sessions are sorted by most-recent message DESC and paginated.
//
// Response:
// {
//   items: [{
//     sessionId:   string          -- E.164 phone (= externalId in contacts)
//     name:        string | null   -- from contacts table when available
//     phone:       string          -- contacts.phone or sessionId when no contact row
//     lastContact: number | null   -- epoch ms of the most recent message
//     msgs:        number          -- total messages in session
//     lastMessage: { content: string; role: 'human' | 'ai' | 'system' }
//   }],
//   total:  number,   -- unique session count (capped at ROWS_LIMIT; warn logged if hit)
//   page:   number,
//   limit:  number,
// }
//
// occurredAt is mode:'timestamp' → Drizzle returns Date; .getTime() = epoch ms.
// Requires module 'integration.ycloud-whatsapp'.

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { conversations, contacts } from '@/lib/db/schema'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { assertEntitlement } from '@/lib/entitlements'

const MODULE_KEY = 'integration.ycloud-whatsapp'
const SOURCE     = 'ycloud-whatsapp'
const MAX_LIMIT  = 50
const ROWS_LIMIT = 10_000    // cap on raw conversation rows fetched for JS dedup

export async function GET(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId } = session.user
  const denied = await assertEntitlement(tenantId, MODULE_KEY)
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const page  = Math.max(1, parseInt(searchParams.get('page')  ?? '1',  10))
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)))

  // ── Fetch all conversation rows, newest first ─────────────────────────────
  // Drizzle returns occurredAt as Date (mode:'timestamp' stores INTEGER seconds,
  // converts to Date on read). First occurrence per sessionId in DESC order = latest.

  const rows = await db
    .select({
      sessionId:  conversations.sessionId,
      role:       conversations.role,
      content:    conversations.content,
      occurredAt: conversations.occurredAt,
    })
    .from(conversations)
    .where(and(
      eq(conversations.tenantId, tenantId),
      eq(conversations.source,   SOURCE),
    ))
    .orderBy(desc(conversations.occurredAt))
    .limit(ROWS_LIMIT)

  if (rows.length === ROWS_LIMIT) {
    console.warn(`[ycloud conversations list] cap de ${ROWS_LIMIT} rows atingido; totais podem estar subestimados`)
  }

  // ── Dedup by sessionId in JS — same pattern as /api/bi/sdr ───────────────
  // Because rows are DESC, the first occurrence per sessionId is the most recent
  // message → captured as lastMessage. Subsequent rows only increment msgs.

  interface SessionEntry {
    sessionId:   string
    lastContact: number | null
    msgs:        number
    lastMessage: { content: string; role: string }
  }

  const sessionMap = new Map<string, SessionEntry>()
  for (const row of rows) {
    const ms = row.occurredAt instanceof Date ? row.occurredAt.getTime() : null
    const ex = sessionMap.get(row.sessionId)
    if (!ex) {
      sessionMap.set(row.sessionId, {
        sessionId:   row.sessionId,
        lastContact: ms,
        msgs:        1,
        lastMessage: { content: row.content, role: row.role },
      })
    } else {
      ex.msgs++
      if (ms && (!ex.lastContact || ms > ex.lastContact)) ex.lastContact = ms
    }
  }

  // ── Sort DESC by lastContact, paginate ────────────────────────────────────

  const sorted = Array.from(sessionMap.values())
    .sort((a, b) => (b.lastContact ?? 0) - (a.lastContact ?? 0))

  const total      = sorted.length
  const pageItems  = sorted.slice((page - 1) * limit, page * limit)

  // ── Contact lookup for the current page ──────────────────────────────────
  // sessionId = E.164 phone = contacts.externalId for source='ycloud-whatsapp'

  const pageIds = pageItems.map(s => s.sessionId)
  const contactRows = pageIds.length > 0
    ? await db
        .select({
          externalId: contacts.externalId,
          name:       contacts.name,
          phone:      contacts.phone,
        })
        .from(contacts)
        .where(and(
          eq(contacts.tenantId, tenantId),
          eq(contacts.source,   SOURCE),
          inArray(contacts.externalId, pageIds),
        ))
    : []

  const contactMap = new Map(contactRows.map(c => [c.externalId, c]))

  // ── Shape response ────────────────────────────────────────────────────────

  const items = pageItems.map(s => {
    const c = contactMap.get(s.sessionId)
    return {
      sessionId:   s.sessionId,
      name:        c?.name  ?? null,
      phone:       c?.phone ?? s.sessionId,   // sessionId = E.164 phone when no contact row
      lastContact: s.lastContact,
      msgs:        s.msgs,
      lastMessage: s.lastMessage,
    }
  })

  return NextResponse.json({ items, total, page, limit })
}
