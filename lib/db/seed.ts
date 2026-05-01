import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from './schema'
import bcrypt from 'bcryptjs'
import fs from 'fs'
import path from 'path'

// Ensure data directory exists for local dev
if (!process.env.TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL.startsWith('file:')) {
  fs.mkdirSync(path.join(process.cwd(), 'data'), { recursive: true })
}

const client = createClient({
  url: process.env.TURSO_DATABASE_URL ?? 'file:./data/app.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
})

const db = drizzle(client, { schema })

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

async function main() {
  // Check if already seeded
  const existing = await db.select().from(schema.tenants).limit(1)
  if (existing.length > 0) {
    console.log('Seed já executado. Apague o banco para re-seedar.')
    process.exit(0)
  }

  const tenantId = uid()
  const now = new Date()

  await db.insert(schema.tenants).values({
    id: tenantId,
    name: 'Multi10',
    slug: 'demo',
    primaryColor: '#FFB400',
    createdAt: now,
  })

  await db.insert(schema.users).values([
    {
      id: uid(), tenantId,
      name: 'Admin Multi10', email: 'admin@multi10.com',
      passwordHash: bcrypt.hashSync('admin123', 10),
      role: 'admin', avatarColor: '#FFB400', avatarBg: '#121316', createdAt: now,
    },
    {
      id: uid(), tenantId,
      name: 'Carlos Mendes', email: 'carlos@multi10.com',
      passwordHash: bcrypt.hashSync('user123', 10),
      role: 'manager', avatarColor: '#9FE1CB', avatarBg: '#085041', createdAt: now,
    },
    {
      id: uid(), tenantId,
      name: 'Ana Lima', email: 'ana@multi10.com',
      passwordHash: bcrypt.hashSync('user123', 10),
      role: 'user', avatarColor: '#B5D4F4', avatarBg: '#0C447C', createdAt: now,
    },
  ])

  const pipelineId = uid()
  await db.insert(schema.pipelines).values({
    id: pipelineId, tenantId, kommoId: '1001', name: 'Pipeline Comercial', isArchived: false,
  })

  const stageData = [
    { name: 'Novo Lead',         color: '#AAAAAA', order: 0 },
    { name: 'Em Contato',        color: '#2563eb', order: 1 },
    { name: 'Proposta Enviada',  color: '#FFB400', order: 2 },
    { name: 'Em Negociação',     color: '#F59E0B', order: 3 },
    { name: 'Fechado - Ganho',   color: '#1E8A3E', order: 4 },
    { name: 'Fechado - Perdido', color: '#D93025', order: 5 },
  ]

  const stageIds: string[] = []
  for (const s of stageData) {
    const id = uid()
    stageIds.push(id)
    await db.insert(schema.stages).values({ id, pipelineId, kommoId: null, name: s.name, color: s.color, order: s.order, type: 0 })
  }

  const leadsData: { name: string; resp: string; price: number; stage: number; days: number }[] = [
    { name: 'Nexus Enterprise',       resp: 'Carlos Mendes',    price: 42000, stage: 4, days: 5  },
    { name: 'Grupo Stellar',          resp: 'Carlos Mendes',    price: 38000, stage: 4, days: 8  },
    { name: 'Omega Capital',          resp: 'Carlos Mendes',    price: 28000, stage: 4, days: 12 },
    { name: 'TechForce Global',       resp: 'Carlos Mendes',    price: 22000, stage: 4, days: 18 },
    { name: 'Vortex Solutions',       resp: 'Carlos Mendes',    price: 18500, stage: 4, days: 22 },
    { name: 'Prime Digital',          resp: 'Carlos Mendes',    price: 14000, stage: 4, days: 28 },
    { name: 'Atlas Ventures',         resp: 'Carlos Mendes',    price: 11000, stage: 4, days: 32 },
    { name: 'Summit Corp',            resp: 'Carlos Mendes',    price: 9500,  stage: 4, days: 40 },
    { name: 'Horizon Brands',         resp: 'Carlos Mendes',    price: 7800,  stage: 4, days: 45 },
    { name: 'Apex Analytics',         resp: 'Carlos Mendes',    price: 6200,  stage: 4, days: 50 },
    { name: 'DataBridge Corp',        resp: 'Carlos Mendes',    price: 31000, stage: 3, days: 3  },
    { name: 'CloudBase Soluções',     resp: 'Carlos Mendes',    price: 25000, stage: 2, days: 6  },
    { name: 'Pulse Tecnologia',       resp: 'Carlos Mendes',    price: 17000, stage: 1, days: 1  },
    { name: 'Redstone Partners',      resp: 'Carlos Mendes',    price: 13000, stage: 5, days: 35 },
    { name: 'Castelo Sistemas',       resp: 'Carlos Mendes',    price: 9000,  stage: 5, days: 55 },
    { name: 'Visão 360 Consultoria',  resp: 'Ana Lima',         price: 35000, stage: 4, days: 6  },
    { name: 'Bright Future Group',    resp: 'Ana Lima',         price: 28000, stage: 4, days: 11 },
    { name: 'StarPath Tech',          resp: 'Ana Lima',         price: 21000, stage: 4, days: 16 },
    { name: 'Lumina Partners',        resp: 'Ana Lima',         price: 18000, stage: 4, days: 24 },
    { name: 'Fortera Soluções',       resp: 'Ana Lima',         price: 12000, stage: 4, days: 30 },
    { name: 'Elevate Digital',        resp: 'Ana Lima',         price: 8500,  stage: 4, days: 38 },
    { name: 'CoreVision',             resp: 'Ana Lima',         price: 6000,  stage: 4, days: 44 },
    { name: 'Metaflow Inc',           resp: 'Ana Lima',         price: 5500,  stage: 4, days: 52 },
    { name: 'Quantum Brands',         resp: 'Ana Lima',         price: 27000, stage: 3, days: 4  },
    { name: 'Innova Systems',         resp: 'Ana Lima',         price: 19000, stage: 2, days: 7  },
    { name: 'Beacon Analytics',       resp: 'Ana Lima',         price: 14000, stage: 1, days: 2  },
    { name: 'Stratus Group',          resp: 'Ana Lima',         price: 8000,  stage: 0, days: 0  },
    { name: 'Kairo Networks',         resp: 'Ana Lima',         price: 11000, stage: 5, days: 20 },
    { name: 'Vega Comercial',         resp: 'Ana Lima',         price: 7500,  stage: 5, days: 42 },
    { name: 'TechStart Soluções',     resp: 'Rafael Torres',    price: 25000, stage: 4, days: 9  },
    { name: 'Prodigy Ventures',       resp: 'Rafael Torres',    price: 20000, stage: 4, days: 15 },
    { name: 'Zephyr Commerce',        resp: 'Rafael Torres',    price: 16000, stage: 4, days: 21 },
    { name: 'Cirrus Digital',         resp: 'Rafael Torres',    price: 13500, stage: 4, days: 27 },
    { name: 'Aura Consultoria',       resp: 'Rafael Torres',    price: 10000, stage: 4, days: 36 },
    { name: 'Bolt Sistemas',          resp: 'Rafael Torres',    price: 7500,  stage: 4, days: 43 },
    { name: 'Nimbus Corp',            resp: 'Rafael Torres',    price: 4500,  stage: 4, days: 50 },
    { name: 'Synapse Labs',           resp: 'Rafael Torres',    price: 22000, stage: 3, days: 5  },
    { name: 'Focal Point Tech',       resp: 'Rafael Torres',    price: 15000, stage: 2, days: 8  },
    { name: 'Origin Brands',          resp: 'Rafael Torres',    price: 9000,  stage: 1, days: 3  },
    { name: 'Tempest Soluções',       resp: 'Rafael Torres',    price: 12000, stage: 5, days: 25 },
    { name: 'Flare Comercial',        resp: 'Rafael Torres',    price: 8000,  stage: 5, days: 48 },
    { name: 'Alpha Grid Solutions',   resp: 'Fernanda Costa',   price: 22000, stage: 4, days: 10 },
    { name: 'Delta Systems',          resp: 'Fernanda Costa',   price: 18000, stage: 4, days: 17 },
    { name: 'Sigma Digital',          resp: 'Fernanda Costa',   price: 14000, stage: 4, days: 23 },
    { name: 'Beta Commerce',          resp: 'Fernanda Costa',   price: 11000, stage: 4, days: 31 },
    { name: 'Gamma Ventures',         resp: 'Fernanda Costa',   price: 8000,  stage: 4, days: 39 },
    { name: 'Epsilon Analytics',      resp: 'Fernanda Costa',   price: 5000,  stage: 4, days: 47 },
    { name: 'Iota Soluções',          resp: 'Fernanda Costa',   price: 20000, stage: 3, days: 4  },
    { name: 'Lambda Corp',            resp: 'Fernanda Costa',   price: 13000, stage: 2, days: 7  },
    { name: 'Mu Tecnologia',          resp: 'Fernanda Costa',   price: 9000,  stage: 1, days: 2  },
    { name: 'Nu Systems',             resp: 'Fernanda Costa',   price: 6000,  stage: 0, days: 1  },
    { name: 'Pi Digital',             resp: 'Fernanda Costa',   price: 10000, stage: 5, days: 28 },
    { name: 'Rho Partners',           resp: 'Fernanda Costa',   price: 7000,  stage: 5, days: 53 },
    { name: 'Rocket Digital',         resp: 'Bruno Alves',      price: 20000, stage: 4, days: 11 },
    { name: 'Orbit Commerce',         resp: 'Bruno Alves',      price: 16000, stage: 4, days: 19 },
    { name: 'Comet Solutions',        resp: 'Bruno Alves',      price: 12000, stage: 4, days: 26 },
    { name: 'Stellar Tech',           resp: 'Bruno Alves',      price: 9000,  stage: 4, days: 34 },
    { name: 'Nova Ventures',          resp: 'Bruno Alves',      price: 5000,  stage: 4, days: 42 },
    { name: 'Pulsar Systems',         resp: 'Bruno Alves',      price: 18000, stage: 3, days: 6  },
    { name: 'Quasar Digital',         resp: 'Bruno Alves',      price: 11000, stage: 2, days: 9  },
    { name: 'Galaxy Corp',            resp: 'Bruno Alves',      price: 7000,  stage: 1, days: 3  },
    { name: 'Nebula Soluções',        resp: 'Bruno Alves',      price: 9000,  stage: 5, days: 30 },
    { name: 'Cosmos Brands',          resp: 'Bruno Alves',      price: 6000,  stage: 5, days: 56 },
  ]

  const leadIds: string[] = []
  for (const l of leadsData) {
    const id = uid()
    leadIds.push(id)
    const ts = daysAgo(l.days)
    await db.insert(schema.leads).values({
      id, tenantId, pipelineId, stageId: stageIds[l.stage],
      kommoId: null, name: l.name, responsibleName: l.resp,
      price: l.price, createdAt: ts, updatedAt: ts, syncedAt: null,
    })
  }

  const extrasData = [
    { i: 0,  tags: ['enterprise', 'prioritário'], notes: 'Cliente veio por indicação. Renovação automática.', priority: 'high' as const },
    { i: 1,  tags: ['enterprise'],               notes: 'Contrato anual. Reunião de kickoff agendada.',       priority: 'high' as const },
    { i: 10, tags: ['quente', 'decisor'],         notes: 'CEO decidirá até sexta-feira.',                    priority: 'high' as const },
    { i: 15, tags: ['prioritário'],               notes: 'Interesse confirmado. Aguardando aprovação.',      priority: 'high' as const },
  ]

  for (const e of extrasData) {
    if (leadIds[e.i]) {
      await db.insert(schema.leadExtras).values({
        id: uid(), leadId: leadIds[e.i], tenantId,
        tags: JSON.stringify(e.tags), notes: e.notes,
        priority: e.priority, customFields: '{}', updatedAt: now,
      })
    }
  }

  console.log('✅ Seed concluído.')
  console.log('   Tenant: Multi10 (demo)')
  console.log('   Login:  admin@multi10.com / admin123')
  console.log(`   Leads:  ${leadsData.length} leads`)
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
