import type {
  DataSourceProvider,
  FetchPage,
  SyncContext,
  CanonicalBatch,
  CanonicalContact,
  CanonicalConversation,
  CanonicalEvent,
} from './types'

// ─── Config ──────────────────────────────────────────────────────────────────

export interface YCloudConfig {
  apiKey: string
  /** HMAC-SHA256 secret for verifying the YCloud-Signature header on webhooks. */
  webhookSecret: string
  /** E.164 business phone used as the sender for outbound WhatsApp messages. */
  fromPhone: string
}

// ─── REST: Contact shapes (YCloud API v2 /contact/contacts) ──────────────────
//
// Source: https://docs.ycloud.com/reference/contact-list.md
//
// Pagination:  page (1-based, 1-100), limit (1-100), includeTotal
// Response:    { items, total?, offset?, length? }
// Contact:     id, phoneNumber (E.164), nickname (display name — no firstName/lastName),
//              email, countryCode, countryName, tags[], lastSeen (RFC 3339),
//              lastMessageToPhoneNumber, createTime, customAttributes[], ownerEmail, sourceType

interface YCloudContactRaw {
  id: string
  phoneNumber?: string
  nickname?: string
  email?: string
  countryCode?: string
  countryName?: string
  tags?: string[]
  /** RFC 3339 — "time at which the contact last sent a message". */
  lastSeen?: string
  lastMessageToPhoneNumber?: string
  createTime?: string
  customAttributes?: Array<{ name: string; value: string }>
  ownerEmail?: string
  sourceType?: string
  sourceId?: string
  sourceUrl?: string
}

interface YCloudContactPage {
  items: YCloudContactRaw[]
  total?: number
  offset?: number
  length?: number
}

// ─── Webhook payload shapes (YCloud API v2) ──────────────────────────────────
//
// Sources:
//   https://docs.ycloud.com/reference/whatsapp-inbound-message-webhook-examples.md
//   https://docs.ycloud.com/reference/whatsapp-message-updated-webhook-examples.md

interface YCloudEnvelope {
  id: string
  type: string
  apiVersion?: string
  createTime?: string
}

interface YCloudInboundMsg extends YCloudEnvelope {
  type: 'whatsapp.inbound_message.received'
  whatsappInboundMessage: {
    id: string               // YCloud message id (deterministic sourceId)
    wamid?: string           // WhatsApp platform message id
    wabaId?: string
    from: string             // customer phone in E.164 — used as sessionId AND externalId
    fromUserId?: string
    fromParentUserId?: string
    customerProfile?: { name?: string; username?: string }
    to: string               // business phone in E.164
    sendTime?: string        // ISO-8601; use as occurredAt
    type?: string            // 'text' | 'image' | 'audio' | ...
    text?: { body: string }
    context?: { from?: string; id?: string }
  }
}

interface YCloudMessageUpdated extends YCloudEnvelope {
  type: 'whatsapp.message.updated'
  whatsappMessage: {
    id: string
    wamid?: string
    recipientUserId?: string
    parentRecipientUserId?: string
    customerProfile?: { name?: string; username?: string }
    status?: 'sent' | 'delivered' | 'read' | 'failed'
    bizType?: string
    type?: string
    text?: { body: string }
    externalId?: string
    createTime?: string
    sendTime?: string
    deliverTime?: string
    readTime?: string
    totalPrice?: number
    currency?: string
    errorCode?: string
    errorMessage?: string
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

const YCLOUD_API_BASE = 'https://api.ycloud.com/v2'
const CONTACT_PAGE_LIMIT = 100
// YCloud page parameter is capped at 100 (range 1-100), so max 10 000 contacts per full sync.
const MAX_CONTACT_PAGE = 100

export const yCloudProvider: DataSourceProvider<YCloudConfig, YCloudContactRaw[]> = {
  key: 'ycloud-whatsapp',
  label: 'YCloud (WhatsApp)',

  parseConfig(raw: unknown): YCloudConfig {
    if (!raw || typeof raw !== 'object') {
      throw new Error('YCloud: config deve ser um objeto')
    }
    const r = raw as Record<string, unknown>
    if (!r.apiKey || typeof r.apiKey !== 'string' || r.apiKey.trim() === '') {
      throw new Error('YCloud: apiKey é obrigatório e não pode ser vazio')
    }
    if (!r.webhookSecret || typeof r.webhookSecret !== 'string' || r.webhookSecret.trim() === '') {
      throw new Error('YCloud: webhookSecret é obrigatório e não pode ser vazio')
    }
    const fromPhone = typeof r.fromPhone === 'string' ? r.fromPhone.trim() : ''
    if (!fromPhone) {
      throw new Error('YCloud: fromPhone (número remetente) é obrigatório')
    }
    // E.164: leading '+', first digit 1-9, 6-14 more digits → total 8-16 chars
    if (!/^\+[1-9]\d{6,14}$/.test(fromPhone)) {
      throw new Error('YCloud: fromPhone deve estar no formato E.164 (ex: +5511999999999)')
    }
    return { apiKey: r.apiKey.trim(), webhookSecret: r.webhookSecret.trim(), fromPhone }
  },

  // Validates the API key with the cheapest available read-only endpoint.
  async testConnection(cfg: YCloudConfig): Promise<{ ok: boolean; message?: string }> {
    try {
      const res = await fetch(`${YCLOUD_API_BASE}/balance`, {
        method: 'GET',
        headers: { 'X-API-Key': cfg.apiKey },
        signal: AbortSignal.timeout(8_000),
      })
      if (res.ok) return { ok: true }
      const body = await res.text().catch(() => '')
      return { ok: false, message: `HTTP ${res.status}: ${body.slice(0, 200)}` }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, message: msg }
    }
  },

  // Fetches a single page of contacts from the YCloud REST API.
  //
  // Conversations and status events do NOT come from here — they arrive exclusively
  // via webhook (see app/api/webhooks/ycloud/[token]/route.ts). This fetch only
  // populates the contacts table as a backfill / periodic refresh.
  async fetch(cfg: YCloudConfig, ctx: SyncContext): Promise<FetchPage<YCloudContactRaw[]>> {
    const cursor = ctx.cursor as { contactsPage?: number } | null
    const page = cursor?.contactsPage ?? 1

    const url = new URL(`${YCLOUD_API_BASE}/contact/contacts`)
    url.searchParams.set('page', String(page))
    url.searchParams.set('limit', String(CONTACT_PAGE_LIMIT))
    url.searchParams.set('includeTotal', 'true')

    let res: Response
    try {
      res = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'X-API-Key': cfg.apiKey },
        signal: AbortSignal.timeout(15_000),
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`YCloud contacts: network/timeout error on page ${page}: ${msg}`)
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`YCloud contacts: API error ${res.status} on page ${page}: ${body.slice(0, 200)}`)
    }

    const data = await res.json() as YCloudContactPage
    const items = data.items ?? []

    // done when:
    //  • fewer items than requested (last page), OR
    //  • total is known and we've covered it, OR
    //  • API page cap reached (page 100 is the maximum, ≈10k contacts)
    const coveredAll = data.total != null && page * CONTACT_PAGE_LIMIT >= data.total
    const hitCap     = page >= MAX_CONTACT_PAGE

    if (hitCap && !coveredAll) {
      const synced = page * CONTACT_PAGE_LIMIT
      const total  = data.total != null ? data.total : 'desconhecido'
      console.warn(
        `[ycloud contacts] cap de 100 páginas atingido; ${synced} de ${total} contatos sincronizados`
      )
    }

    const done = items.length < CONTACT_PAGE_LIMIT || coveredAll || hitCap

    return {
      raw: items,
      nextCursor: { contactsPage: page + 1 },
      done,
    }
  },

  // Maps one page of YCloud Contact records to CanonicalContact.
  //
  // externalId = phoneNumber (E.164) — identical to msg.from used in webhooks,
  // guaranteeing that REST backfill and webhook upserts hit the same row (no duplicates).
  // Falls back to the YCloud contact id when phoneNumber is absent (edge case).
  //
  // lastInteractionAt = parseMs(lastSeen). The upsertBatch MAX logic ensures this never
  // regresses a more recent timestamp written by an earlier webhook event.
  normalize(raw: YCloudContactRaw[], _ctx: SyncContext): CanonicalBatch {
    const contacts: CanonicalContact[] = raw.map(c => {
      const externalId = c.phoneNumber ?? c.id

      return {
        externalId,
        name:  c.nickname ?? undefined,
        phone: c.phoneNumber ?? undefined,
        email: c.email ?? undefined,
        tags:  c.tags ?? [],
        // lastSeen = "time contact last sent a message" — best available proxy for lastInteractionAt
        lastInteractionAt: parseMs(c.lastSeen),
        metadata: {
          yCloudId:                c.id,
          countryCode:             c.countryCode,
          countryName:             c.countryName,
          lastMessageToPhoneNumber: c.lastMessageToPhoneNumber,
          sourceType:              c.sourceType,
        },
        extra: {
          customAttributes: c.customAttributes ?? [],
          ownerEmail:       c.ownerEmail,
        },
      }
    })

    return { contacts }
  },
}

// ─── Webhook normalizer ───────────────────────────────────────────────────────
//
// Pure function (no I/O) called by the webhook route to convert a raw YCloud
// event into canonical platform records for upsert into Turso.

/** Parses an ISO-8601 string to epoch ms; returns undefined on missing/invalid input. */
function parseMs(iso: string | undefined): number | undefined {
  if (!iso) return undefined
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? undefined : ms
}

/**
 * Maps a raw YCloud webhook event payload to a CanonicalBatch.
 *
 * Handled event types:
 *   whatsapp.inbound_message.received → CanonicalConversation (role: 'human')
 *                                     + CanonicalContact (externalId = msg.from = E.164 phone)
 *   whatsapp.message.updated          → CanonicalEvent (eventType: whatsapp_status_*)
 *
 * The CanonicalContact emitted on each inbound message ensures the contacts table
 * stays populated in real-time without requiring a REST backfill first.
 * externalId = msg.from (E.164) matches phoneNumber from the REST endpoint — both
 * refer to the same contact row (idempotent upsert, no duplicates).
 *
 * All other event types return an empty batch (never throws).
 */
export function normalizeWebhookEvent(
  event: unknown,
  _ctx: { tenantId: string },
): CanonicalBatch {
  if (!event || typeof event !== 'object') return {}

  const env = event as YCloudEnvelope

  switch (env.type) {
    case 'whatsapp.inbound_message.received': {
      const e = event as YCloudInboundMsg
      const msg = e.whatsappInboundMessage
      if (!msg?.id || !msg.from) return {}

      // For non-text messages (image, audio, video, …) there is no text.body;
      // use a bracketed type placeholder so content is never stored empty.
      const content = msg.text?.body ?? (msg.type ? `[${msg.type}]` : '[unknown]')

      const occurredAt = parseMs(msg.sendTime) ?? parseMs(env.createTime)

      const conversation: CanonicalConversation = {
        sourceId:  msg.id,          // deterministic YCloud message id — safe to upsert repeatedly
        sessionId: msg.from,        // customer E.164 phone — stable session key
        role:      'human',
        content,
        occurredAt,
        metadata: {
          wamid:        msg.wamid,
          from:         msg.from,
          to:           msg.to,
          messageType:  msg.type,
          customerName: msg.customerProfile?.name,
          replyToWamid: msg.context?.id,
        },
      }

      // Upsert a contact so the contacts table stays up-to-date with every inbound message.
      // externalId = msg.from (E.164) = phoneNumber from REST — guaranteed same row, no duplicates.
      // The upsertBatch MAX logic ensures occurredAt only advances, never regresses.
      const contact: CanonicalContact = {
        externalId: msg.from,
        name:       msg.customerProfile?.name,
        phone:      msg.from,
        lastInteractionAt: occurredAt,
        metadata: {
          customerUsername: msg.customerProfile?.username,
        },
      }

      return { conversations: [conversation], contacts: [contact] }
    }

    case 'whatsapp.message.updated': {
      const e = event as YCloudMessageUpdated
      const msg = e.whatsappMessage
      if (!msg?.id || !msg.status) return {}

      // Pick the timestamp that best reflects when this specific transition occurred,
      // falling back through the chain to the envelope's createTime (always present).
      const occurredAt =
        (msg.status === 'read'      ? parseMs(msg.readTime)    : undefined) ??
        (msg.status === 'delivered' ? parseMs(msg.deliverTime) : undefined) ??
        parseMs(msg.sendTime) ??
        parseMs(msg.createTime) ??
        parseMs(env.createTime)

      const ev: CanonicalEvent = {
        sourceId:  `${msg.id}:${msg.status}`,   // deterministic — safe to upsert repeatedly
        eventType: `whatsapp_status_${msg.status}`,
        entityId:  msg.recipientUserId,
        occurredAt: occurredAt ?? 0,
        payload: {
          messageId:    msg.id,
          wamid:        msg.wamid,
          status:       msg.status,
          errorCode:    msg.errorCode,
          errorMessage: msg.errorMessage,
        },
      }
      return { events: [ev] }
    }

    default:
      return {}
  }
}

// ─── Messaging actions ────────────────────────────────────────────────────────
//
// Sending is an action, NOT part of the DataSourceProvider sync contract.
// These functions are exported separately and called from action-layer API routes.

export type SendWhatsappParams =
  | { to: string; type: 'text'; body: string }
  | {
      to: string
      type: 'template'
      templateName: string
      languageCode: string
      /** Body components, e.g. [{ type:'body', parameters:[{ type:'text', text:'...' }] }].
       *  Omit or pass [] if the template has no variables. */
      components?: unknown[]
    }

export interface SendWhatsappResult {
  /** YCloud message identifier — field name 'id' in the WhatsappMessage response object. */
  id: string
  status?: string
}

/**
 * Sends a WhatsApp message (text or template) via the YCloud API.
 *
 * POST /v2/whatsapp/messages  ·  auth: X-API-Key
 *
 * Text body:
 *   { from, to, type:'text', text:{ body, preview_url:false } }
 *
 * Template body:
 *   { from, to, type:'template', template:{ name, language:{ code }, components? } }
 *   components is omitted from the request when empty/undefined.
 *
 * Returns { id, status } from the YCloud WhatsappMessage response.
 * Throws a descriptive Error on non-2xx or timeout (includes HTTP status + YCloud detail).
 */
export async function sendWhatsappMessage(
  cfg: YCloudConfig,
  params: SendWhatsappParams,
): Promise<SendWhatsappResult> {
  let requestBody: Record<string, unknown>

  if (params.type === 'text') {
    requestBody = {
      from: cfg.fromPhone,
      to:   params.to,
      type: 'text',
      text: { body: params.body, preview_url: false },
    }
  } else {
    const template: Record<string, unknown> = {
      name:     params.templateName,
      language: { code: params.languageCode },
    }
    if (params.components && params.components.length > 0) {
      template.components = params.components
    }
    requestBody = {
      from:     cfg.fromPhone,
      to:       params.to,
      type:     'template',
      template,
    }
  }

  let res: Response
  try {
    res = await fetch(`${YCLOUD_API_BASE}/whatsapp/messages`, {
      method:  'POST',
      headers: {
        'X-API-Key':    cfg.apiKey,
        'Content-Type': 'application/json',
      },
      body:   JSON.stringify(requestBody),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`YCloud send: network/timeout error: ${msg}`)
  }

  if (!res.ok) {
    let detail = ''
    try {
      const errBody = await res.json() as Record<string, unknown>
      detail = String(errBody.message ?? errBody.error ?? JSON.stringify(errBody))
    } catch {
      detail = await res.text().catch(() => '')
    }
    throw new Error(`YCloud send: HTTP ${res.status} – ${detail.slice(0, 300)}`)
  }

  const data = await res.json() as { id: string; status?: string }
  return { id: data.id, status: data.status }
}

// ─── Template listing ─────────────────────────────────────────────────────────

export interface WhatsappTemplate {
  name:        string
  language:    string
  category?:   string
  status:      string
  components?: unknown[]
}

interface YCloudTemplatesPage {
  items: WhatsappTemplate[]
  total?: number
}

/**
 * Returns all WhatsApp message templates for this account.
 *
 * GET /v2/whatsapp/templates?limit=100&page=N  ·  auth: X-API-Key
 * Paginates automatically until items.length < limit (last page).
 *
 * status field values include 'approved', 'rejected', 'pending', etc.
 * The caller (or UI) should filter by status === 'approved' as needed.
 * Throws on non-2xx or timeout.
 */
export async function listWhatsappTemplates(
  cfg: YCloudConfig,
): Promise<WhatsappTemplate[]> {
  const LIMIT = 100
  const all: WhatsappTemplate[] = []
  let page = 1

  for (;;) {
    const url = new URL(`${YCLOUD_API_BASE}/whatsapp/templates`)
    url.searchParams.set('limit', String(LIMIT))
    url.searchParams.set('page',  String(page))

    let res: Response
    try {
      res = await fetch(url.toString(), {
        method:  'GET',
        headers: { 'X-API-Key': cfg.apiKey },
        signal:  AbortSignal.timeout(15_000),
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`YCloud templates: network/timeout error on page ${page}: ${msg}`)
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`YCloud templates: HTTP ${res.status} on page ${page}: ${body.slice(0, 200)}`)
    }

    const data = await res.json() as YCloudTemplatesPage
    const items = data.items ?? []
    all.push(...items)

    if (items.length < LIMIT) break
    page++
  }

  return all
}
