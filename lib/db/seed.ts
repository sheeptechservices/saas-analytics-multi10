import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import bcrypt from 'bcryptjs'

const dbPath = path.join(process.cwd(), 'data', 'app.db')
fs.mkdirSync(path.dirname(dbPath), { recursive: true })

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return Math.floor(d.getTime() / 1000)
}

db.exec(`
  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    primary_color TEXT NOT NULL DEFAULT '#FFB400',
    logo_url TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    avatar_color TEXT NOT NULL DEFAULT '#FFB400',
    avatar_bg TEXT NOT NULL DEFAULT '#121316',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS integrations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    provider TEXT NOT NULL DEFAULT 'kommo',
    access_token TEXT,
    refresh_token TEXT,
    expires_at INTEGER,
    account_domain TEXT,
    account_id TEXT,
    client_id TEXT,
    client_secret TEXT,
    last_sync_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pipelines (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    kommo_id TEXT,
    name TEXT NOT NULL,
    is_archived INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS stages (
    id TEXT PRIMARY KEY,
    pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
    kommo_id TEXT,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#AAAAAA',
    "order" INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
    stage_id TEXT NOT NULL REFERENCES stages(id),
    kommo_id TEXT,
    name TEXT NOT NULL,
    responsible_name TEXT NOT NULL DEFAULT '—',
    price REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    synced_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS lead_extras (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL REFERENCES leads(id) UNIQUE,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    tags TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'normal',
    custom_fields TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL
  );
`)

const existing = db.prepare('SELECT id FROM tenants WHERE slug = ?').get('demo')
if (existing) {
  console.log('Seed já executado. Delete data/app.db para re-seedar.')
  process.exit(0)
}

const tenantId = uid()
const now = Math.floor(Date.now() / 1000)

db.prepare('INSERT INTO tenants VALUES (?,?,?,?,?,?)').run(
  tenantId, 'Multi10', 'demo', '#FFB400', null, now
)

const hash = bcrypt.hashSync('admin123', 10)
db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?)').run(
  uid(), tenantId, 'Admin Multi10', 'admin@multi10.com', hash, 'admin', '#FFB400', '#121316', now
)
db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?)').run(
  uid(), tenantId, 'Carlos Mendes', 'carlos@multi10.com', bcrypt.hashSync('user123', 10), 'manager', '#9FE1CB', '#085041', now
)
db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?)').run(
  uid(), tenantId, 'Ana Lima', 'ana@multi10.com', bcrypt.hashSync('user123', 10), 'user', '#B5D4F4', '#0C447C', now
)

const pipelineId = uid()
db.prepare('INSERT INTO pipelines VALUES (?,?,?,?,?)').run(pipelineId, tenantId, '1001', 'Pipeline Comercial', 0)

const stageData = [
  { name: 'Novo Lead',          color: '#AAAAAA', order: 0 },
  { name: 'Em Contato',         color: '#2563eb', order: 1 },
  { name: 'Proposta Enviada',   color: '#FFB400', order: 2 },
  { name: 'Em Negociação',      color: '#F59E0B', order: 3 },
  { name: 'Fechado - Ganho',    color: '#1E8A3E', order: 4 },
  { name: 'Fechado - Perdido',  color: '#D93025', order: 5 },
]
const stageIds = stageData.map(s => {
  const id = uid()
  db.prepare('INSERT INTO stages VALUES (?,?,?,?,?,?)').run(id, pipelineId, null, s.name, s.color, s.order)
  return id
})

// Stage indices: 0=Novo, 1=Contato, 2=Proposta, 3=Negociação, 4=Ganho, 5=Perdido
const leadsData: { name: string; resp: string; price: number; stage: number; days: number }[] = [
  // ── Carlos Mendes — Top 1 (R$185k ganhos, 10 ganhos / 3 ativos / 2 perdidos)
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

  // ── Ana Lima — Top 2 (R$128k ganhos, 8 ganhos / 4 ativos / 2 perdidos)
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

  // ── Rafael Torres — Top 3 (R$96k ganhos, 7 ganhos / 3 ativos / 2 perdidos)
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

  // ── Fernanda Costa — 4º (R$78k ganhos, 6 ganhos / 4 ativos / 2 perdidos)
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

  // ── Bruno Alves — 5º (R$62k ganhos, 5 ganhos / 3 ativos / 2 perdidos)
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

  // ── Juliana Pereira — 6º (R$51k ganhos, 4 ganhos / 3 ativos / 1 perdido)
  { name: 'Maple Consultoria',      resp: 'Juliana Pereira',  price: 18000, stage: 4, days: 13 },
  { name: 'Cedar Soluções',         resp: 'Juliana Pereira',  price: 15000, stage: 4, days: 20 },
  { name: 'Birch Systems',          resp: 'Juliana Pereira',  price: 11000, stage: 4, days: 29 },
  { name: 'Willow Tech',            resp: 'Juliana Pereira',  price: 7000,  stage: 4, days: 37 },
  { name: 'Elm Digital',            resp: 'Juliana Pereira',  price: 16000, stage: 3, days: 5  },
  { name: 'Pine Commerce',          resp: 'Juliana Pereira',  price: 10000, stage: 2, days: 8  },
  { name: 'Oak Ventures',           resp: 'Juliana Pereira',  price: 7000,  stage: 1, days: 2  },
  { name: 'Ash Partners',           resp: 'Juliana Pereira',  price: 9000,  stage: 5, days: 33 },

  // ── Marcos Oliveira — 7º (R$42k ganhos, 4 ganhos / 4 ativos / 2 perdidos)
  { name: 'Iron Bridge Corp',       resp: 'Marcos Oliveira',  price: 15000, stage: 4, days: 14 },
  { name: 'Steel Wave Digital',     resp: 'Marcos Oliveira',  price: 13000, stage: 4, days: 22 },
  { name: 'Copper Lane Tech',       resp: 'Marcos Oliveira',  price: 9000,  stage: 4, days: 31 },
  { name: 'Bronze Peak Solutions',  resp: 'Marcos Oliveira',  price: 5000,  stage: 4, days: 40 },
  { name: 'Titanium Ventures',      resp: 'Marcos Oliveira',  price: 14000, stage: 3, days: 7  },
  { name: 'Chrome Commerce',        resp: 'Marcos Oliveira',  price: 10000, stage: 2, days: 10 },
  { name: 'Platinum Systems',       resp: 'Marcos Oliveira',  price: 7000,  stage: 1, days: 4  },
  { name: 'Silver Stream',          resp: 'Marcos Oliveira',  price: 5000,  stage: 0, days: 1  },
  { name: 'Gold Rush Digital',      resp: 'Marcos Oliveira',  price: 8000,  stage: 5, days: 27 },
  { name: 'Mercury Labs',           resp: 'Marcos Oliveira',  price: 6000,  stage: 5, days: 50 },

  // ── Camila Rodrigues — 8º (R$35k ganhos, 3 ganhos / 3 ativos / 1 perdido)
  { name: 'Azul Soluções',          resp: 'Camila Rodrigues', price: 15000, stage: 4, days: 16 },
  { name: 'Verde Digital',          resp: 'Camila Rodrigues', price: 12000, stage: 4, days: 24 },
  { name: 'Branco Systems',         resp: 'Camila Rodrigues', price: 8000,  stage: 4, days: 35 },
  { name: 'Vermelho Commerce',      resp: 'Camila Rodrigues', price: 13000, stage: 3, days: 8  },
  { name: 'Amarelo Tech',           resp: 'Camila Rodrigues', price: 9000,  stage: 2, days: 11 },
  { name: 'Rosa Ventures',          resp: 'Camila Rodrigues', price: 6000,  stage: 1, days: 3  },
  { name: 'Laranja Partners',       resp: 'Camila Rodrigues', price: 7000,  stage: 5, days: 38 },

  // ── Felipe Santos — 9º (R$28k ganhos, 3 ganhos / 4 ativos / 2 perdidos)
  { name: 'Motion Digital',         resp: 'Felipe Santos',    price: 12000, stage: 4, days: 18 },
  { name: 'Action Systems',         resp: 'Felipe Santos',    price: 10000, stage: 4, days: 26 },
  { name: 'React Commerce',         resp: 'Felipe Santos',    price: 6000,  stage: 4, days: 37 },
  { name: 'Flow Tech',              resp: 'Felipe Santos',    price: 11000, stage: 3, days: 9  },
  { name: 'Flux Ventures',          resp: 'Felipe Santos',    price: 8000,  stage: 2, days: 12 },
  { name: 'Stream Corp',            resp: 'Felipe Santos',    price: 5000,  stage: 1, days: 5  },
  { name: 'Wave Soluções',          resp: 'Felipe Santos',    price: 4000,  stage: 0, days: 2  },
  { name: 'Tide Digital',           resp: 'Felipe Santos',    price: 7000,  stage: 5, days: 32 },
  { name: 'Surge Analytics',        resp: 'Felipe Santos',    price: 5000,  stage: 5, days: 51 },

  // ── Larissa Gomes — 10º (R$22k ganhos, 2 ganhos / 3 ativos / 2 perdidos)
  { name: 'Spark Digital',          resp: 'Larissa Gomes',    price: 13000, stage: 4, days: 20 },
  { name: 'Flare Systems',          resp: 'Larissa Gomes',    price: 9000,  stage: 4, days: 30 },
  { name: 'Blaze Commerce',         resp: 'Larissa Gomes',    price: 10000, stage: 3, days: 10 },
  { name: 'Ember Tech',             resp: 'Larissa Gomes',    price: 7000,  stage: 2, days: 13 },
  { name: 'Ash Ventures',           resp: 'Larissa Gomes',    price: 5000,  stage: 1, days: 6  },
  { name: 'Cinder Corp',            resp: 'Larissa Gomes',    price: 6000,  stage: 5, days: 29 },
  { name: 'Coal Soluções',          resp: 'Larissa Gomes',    price: 4000,  stage: 5, days: 54 },

  // ── Rodrigo Ferreira — 11º (R$16k ganhos, 2 ganhos / 3 ativos / 3 perdidos)
  { name: 'Harbor Digital',         resp: 'Rodrigo Ferreira', price: 9000,  stage: 4, days: 22 },
  { name: 'Dock Systems',           resp: 'Rodrigo Ferreira', price: 7000,  stage: 4, days: 33 },
  { name: 'Port Commerce',          resp: 'Rodrigo Ferreira', price: 8000,  stage: 3, days: 11 },
  { name: 'Bay Tech',               resp: 'Rodrigo Ferreira', price: 5000,  stage: 2, days: 14 },
  { name: 'Cove Ventures',          resp: 'Rodrigo Ferreira', price: 4000,  stage: 1, days: 7  },
  { name: 'Reef Partners',          resp: 'Rodrigo Ferreira', price: 6000,  stage: 5, days: 25 },
  { name: 'Shoal Analytics',        resp: 'Rodrigo Ferreira', price: 4500,  stage: 5, days: 44 },
  { name: 'Tide Corp',              resp: 'Rodrigo Ferreira', price: 3500,  stage: 5, days: 60 },

  // ── Patricia Silva — 12º (R$13k ganhos, 2 ganhos / 2 ativos / 1 perdido)
  { name: 'Crown Digital',          resp: 'Patricia Silva',   price: 8000,  stage: 4, days: 25 },
  { name: 'Jewel Systems',          resp: 'Patricia Silva',   price: 5000,  stage: 4, days: 36 },
  { name: 'Pearl Commerce',         resp: 'Patricia Silva',   price: 7000,  stage: 3, days: 12 },
  { name: 'Ruby Tech',              resp: 'Patricia Silva',   price: 5000,  stage: 2, days: 15 },
  { name: 'Gem Partners',           resp: 'Patricia Silva',   price: 4000,  stage: 5, days: 41 },

  // ── Gustavo Andrade — 13º (R$10k ganhos, 1 ganho / 4 ativos / 2 perdidos)
  { name: 'Storm Digital',          resp: 'Gustavo Andrade',  price: 10000, stage: 4, days: 28 },
  { name: 'Thunder Systems',        resp: 'Gustavo Andrade',  price: 8000,  stage: 3, days: 13 },
  { name: 'Lightning Commerce',     resp: 'Gustavo Andrade',  price: 6000,  stage: 2, days: 16 },
  { name: 'Rain Tech',              resp: 'Gustavo Andrade',  price: 4500,  stage: 1, days: 8  },
  { name: 'Cloud Ventures',         resp: 'Gustavo Andrade',  price: 3500,  stage: 0, days: 3  },
  { name: 'Fog Analytics',          resp: 'Gustavo Andrade',  price: 5000,  stage: 5, days: 35 },
  { name: 'Mist Corp',              resp: 'Gustavo Andrade',  price: 4000,  stage: 5, days: 58 },

  // ── Beatriz Carvalho — 14º (R$7k ganhos, 1 ganho / 3 ativos / 2 perdidos)
  { name: 'Flame Digital',          resp: 'Beatriz Carvalho', price: 7000,  stage: 4, days: 30 },
  { name: 'Heat Systems',           resp: 'Beatriz Carvalho', price: 5500,  stage: 3, days: 14 },
  { name: 'Warm Commerce',          resp: 'Beatriz Carvalho', price: 4000,  stage: 2, days: 17 },
  { name: 'Glow Tech',              resp: 'Beatriz Carvalho', price: 3500,  stage: 1, days: 9  },
  { name: 'Burn Ventures',          resp: 'Beatriz Carvalho', price: 4500,  stage: 5, days: 38 },
  { name: 'Char Partners',          resp: 'Beatriz Carvalho', price: 3000,  stage: 5, days: 62 },

  // ── Diego Martins — 15º (R$5k ganhos, 1 ganho / 2 ativos / 2 perdidos)
  { name: 'Arrow Digital',          resp: 'Diego Martins',    price: 5000,  stage: 4, days: 33 },
  { name: 'Dart Systems',           resp: 'Diego Martins',    price: 4500,  stage: 3, days: 15 },
  { name: 'Spear Commerce',         resp: 'Diego Martins',    price: 3500,  stage: 2, days: 18 },
  { name: 'Lance Tech',             resp: 'Diego Martins',    price: 3000,  stage: 5, days: 40 },
  { name: 'Javelin Ventures',       resp: 'Diego Martins',    price: 2500,  stage: 5, days: 65 },

  // ── Sabrina Lopes — 16º (R$4k ganhos, 1 ganho / 2 ativos / 1 perdido)
  { name: 'Forest Digital',         resp: 'Sabrina Lopes',    price: 4000,  stage: 4, days: 36 },
  { name: 'Grove Systems',          resp: 'Sabrina Lopes',    price: 3500,  stage: 3, days: 16 },
  { name: 'Meadow Commerce',        resp: 'Sabrina Lopes',    price: 3000,  stage: 2, days: 19 },
  { name: 'Field Ventures',         resp: 'Sabrina Lopes',    price: 2500,  stage: 5, days: 45 },

  // ── Thiago Azevedo — 17º (R$3k ganhos, 1 ganho / 2 ativos / 2 perdidos)
  { name: 'River Digital',          resp: 'Thiago Azevedo',   price: 3000,  stage: 4, days: 40 },
  { name: 'Lake Systems',           resp: 'Thiago Azevedo',   price: 2500,  stage: 3, days: 17 },
  { name: 'Ocean Commerce',         resp: 'Thiago Azevedo',   price: 2000,  stage: 1, days: 10 },
  { name: 'Sea Tech',               resp: 'Thiago Azevedo',   price: 2000,  stage: 5, days: 42 },
  { name: 'Stream Ventures',        resp: 'Thiago Azevedo',   price: 1500,  stage: 5, days: 68 },

  // ── Amanda Rocha — 18º (R$0 ganhos, 0 ganhos / 3 ativos / 1 perdido)
  { name: 'Spring Digital',         resp: 'Amanda Rocha',     price: 4000,  stage: 3, days: 6  },
  { name: 'Summer Systems',         resp: 'Amanda Rocha',     price: 3000,  stage: 2, days: 9  },
  { name: 'Autumn Commerce',        resp: 'Amanda Rocha',     price: 2500,  stage: 1, days: 4  },
  { name: 'Winter Tech',            resp: 'Amanda Rocha',     price: 2000,  stage: 5, days: 46 },

  // ── Leonardo Costa — 19º (R$0 ganhos, 0 ganhos / 2 ativos / 1 perdido)
  { name: 'Pixel Digital',          resp: 'Leonardo Costa',   price: 3500,  stage: 3, days: 7  },
  { name: 'Voxel Systems',          resp: 'Leonardo Costa',   price: 2500,  stage: 1, days: 5  },
  { name: 'Texel Commerce',         resp: 'Leonardo Costa',   price: 2000,  stage: 5, days: 48 },

  // ── Renata Souza — 20º (R$0 ganhos, 0 ganhos / 1 ativo / 2 perdidos)
  { name: 'Mono Digital',           resp: 'Renata Souza',     price: 3000,  stage: 2, days: 8  },
  { name: 'Duo Systems',            resp: 'Renata Souza',     price: 2000,  stage: 5, days: 44 },
  { name: 'Trio Commerce',          resp: 'Renata Souza',     price: 1500,  stage: 5, days: 70 },

  // ── Vinícius Ramos — 21º (R$55k ganhos, 4 ganhos / 3 ativos / 2 perdidos)
  { name: 'Vertex Soluções',        resp: 'Vinícius Ramos',   price: 22000, stage: 4, days: 7  },
  { name: 'Apex Data',              resp: 'Vinícius Ramos',   price: 16000, stage: 4, days: 14 },
  { name: 'Zenith Digital',         resp: 'Vinícius Ramos',   price: 11000, stage: 4, days: 23 },
  { name: 'Nadir Systems',          resp: 'Vinícius Ramos',   price: 6000,  stage: 4, days: 35 },
  { name: 'Polar Tech',             resp: 'Vinícius Ramos',   price: 19000, stage: 3, days: 5  },
  { name: 'Axis Commerce',          resp: 'Vinícius Ramos',   price: 12000, stage: 2, days: 9  },
  { name: 'Core Ventures',          resp: 'Vinícius Ramos',   price: 8000,  stage: 1, days: 2  },
  { name: 'Node Analytics',         resp: 'Vinícius Ramos',   price: 7000,  stage: 5, days: 28 },
  { name: 'Edge Partners',          resp: 'Vinícius Ramos',   price: 5000,  stage: 5, days: 52 },

  // ── Isabela Nunes — 22º (R$44k ganhos, 4 ganhos / 2 ativos / 1 perdido)
  { name: 'Prism Digital',          resp: 'Isabela Nunes',    price: 18000, stage: 4, days: 9  },
  { name: 'Lens Systems',           resp: 'Isabela Nunes',    price: 13000, stage: 4, days: 19 },
  { name: 'Focus Commerce',         resp: 'Isabela Nunes',    price: 8500,  stage: 4, days: 28 },
  { name: 'Aperture Tech',          resp: 'Isabela Nunes',    price: 4500,  stage: 4, days: 41 },
  { name: 'Shutter Ventures',       resp: 'Isabela Nunes',    price: 15000, stage: 3, days: 6  },
  { name: 'Frame Corp',             resp: 'Isabela Nunes',    price: 10000, stage: 2, days: 10 },
  { name: 'Pixel Partners',         resp: 'Isabela Nunes',    price: 6000,  stage: 5, days: 36 },

  // ── Eduardo Bastos — 23º (R$37k ganhos, 3 ganhos / 3 ativos / 2 perdidos)
  { name: 'Bridge Digital',         resp: 'Eduardo Bastos',   price: 16000, stage: 4, days: 11 },
  { name: 'Arch Systems',           resp: 'Eduardo Bastos',   price: 13000, stage: 4, days: 20 },
  { name: 'Span Commerce',          resp: 'Eduardo Bastos',   price: 8000,  stage: 4, days: 32 },
  { name: 'Beam Tech',              resp: 'Eduardo Bastos',   price: 14000, stage: 3, days: 8  },
  { name: 'Truss Ventures',         resp: 'Eduardo Bastos',   price: 9000,  stage: 2, days: 12 },
  { name: 'Cable Partners',         resp: 'Eduardo Bastos',   price: 6000,  stage: 1, days: 4  },
  { name: 'Bolt Analytics',         resp: 'Eduardo Bastos',   price: 5000,  stage: 5, days: 31 },
  { name: 'Rivet Corp',             resp: 'Eduardo Bastos',   price: 4000,  stage: 5, days: 57 },

  // ── Marina Figueiredo — 24º (R$29k ganhos, 3 ganhos / 2 ativos / 1 perdido)
  { name: 'Crest Digital',          resp: 'Marina Figueiredo', price: 13000, stage: 4, days: 13 },
  { name: 'Peak Systems',           resp: 'Marina Figueiredo', price: 10000, stage: 4, days: 22 },
  { name: 'Summit Commerce',        resp: 'Marina Figueiredo', price: 6000,  stage: 4, days: 34 },
  { name: 'Ridge Tech',             resp: 'Marina Figueiredo', price: 12000, stage: 3, days: 9  },
  { name: 'Slope Ventures',         resp: 'Marina Figueiredo', price: 8000,  stage: 2, days: 13 },
  { name: 'Valley Partners',        resp: 'Marina Figueiredo', price: 5000,  stage: 5, days: 39 },

  // ── Pedro Cavalcante — 25º (R$20k ganhos, 2 ganhos / 4 ativos / 2 perdidos)
  { name: 'Signal Digital',         resp: 'Pedro Cavalcante', price: 12000, stage: 4, days: 15 },
  { name: 'Pulse Systems',          resp: 'Pedro Cavalcante', price: 8000,  stage: 4, days: 27 },
  { name: 'Wave Commerce',          resp: 'Pedro Cavalcante', price: 11000, stage: 3, days: 10 },
  { name: 'Freq Tech',              resp: 'Pedro Cavalcante', price: 7000,  stage: 2, days: 14 },
  { name: 'Band Ventures',          resp: 'Pedro Cavalcante', price: 5000,  stage: 1, days: 6  },
  { name: 'Amp Corp',               resp: 'Pedro Cavalcante', price: 4000,  stage: 0, days: 2  },
  { name: 'Volt Analytics',         resp: 'Pedro Cavalcante', price: 5000,  stage: 5, days: 33 },
  { name: 'Watt Partners',          resp: 'Pedro Cavalcante', price: 3500,  stage: 5, days: 59 },

  // ── Letícia Drummond — 26º (R$14k ganhos, 2 ganhos / 2 ativos / 1 perdido)
  { name: 'Craft Digital',          resp: 'Letícia Drummond', price: 9000,  stage: 4, days: 18 },
  { name: 'Build Systems',          resp: 'Letícia Drummond', price: 5000,  stage: 4, days: 29 },
  { name: 'Make Commerce',          resp: 'Letícia Drummond', price: 8000,  stage: 3, days: 11 },
  { name: 'Create Tech',            resp: 'Letícia Drummond', price: 6000,  stage: 2, days: 15 },
  { name: 'Form Ventures',          resp: 'Letícia Drummond', price: 4000,  stage: 5, days: 43 },

  // ── Henrique Monteiro — 27º (R$9k ganhos, 1 ganho / 3 ativos / 2 perdidos)
  { name: 'Scope Digital',          resp: 'Henrique Monteiro', price: 9000,  stage: 4, days: 21 },
  { name: 'Scale Systems',          resp: 'Henrique Monteiro', price: 7000,  stage: 3, days: 12 },
  { name: 'Range Commerce',         resp: 'Henrique Monteiro', price: 5000,  stage: 2, days: 16 },
  { name: 'Span Tech',              resp: 'Henrique Monteiro', price: 4000,  stage: 1, days: 7  },
  { name: 'Width Ventures',         resp: 'Henrique Monteiro', price: 4500,  stage: 5, days: 36 },
  { name: 'Depth Analytics',        resp: 'Henrique Monteiro', price: 3500,  stage: 5, days: 63 },

  // ── Natália Borges — 28º (R$6k ganhos, 1 ganho / 2 ativos / 1 perdido)
  { name: 'Glow Digital',           resp: 'Natália Borges',   price: 6000,  stage: 4, days: 24 },
  { name: 'Shine Systems',          resp: 'Natália Borges',   price: 5000,  stage: 3, days: 13 },
  { name: 'Bright Commerce',        resp: 'Natália Borges',   price: 3500,  stage: 2, days: 17 },
  { name: 'Radiant Partners',       resp: 'Natália Borges',   price: 3000,  stage: 5, days: 47 },

  // ── Caio Esteves — 29º (R$0, 0 ganhos / 3 ativos / 2 perdidos)
  { name: 'Draft Digital',          resp: 'Caio Esteves',     price: 4000,  stage: 3, days: 5  },
  { name: 'Sketch Systems',         resp: 'Caio Esteves',     price: 3000,  stage: 2, days: 8  },
  { name: 'Render Commerce',        resp: 'Caio Esteves',     price: 2500,  stage: 1, days: 3  },
  { name: 'Export Tech',            resp: 'Caio Esteves',     price: 2000,  stage: 5, days: 40 },
  { name: 'Print Ventures',         resp: 'Caio Esteves',     price: 1500,  stage: 5, days: 66 },

  // ── Aline Teixeira — 30º (R$0, 0 ganhos / 2 ativos / 1 perdido)
  { name: 'Alpha Loop',             resp: 'Aline Teixeira',   price: 3500,  stage: 3, days: 4  },
  { name: 'Beta Loop Systems',      resp: 'Aline Teixeira',   price: 2500,  stage: 1, days: 6  },
  { name: 'Gamma Loop Commerce',    resp: 'Aline Teixeira',   price: 2000,  stage: 5, days: 50 },
]

const leadIds: string[] = []
for (const l of leadsData) {
  const id = uid()
  leadIds.push(id)
  const ts = daysAgo(l.days)
  db.prepare('INSERT INTO leads VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
    id, tenantId, pipelineId, stageIds[l.stage], null,
    l.name, l.resp, l.price, ts, ts, null
  )
}

// Extras para alguns leads
const extrasData = [
  { i: 0,  tags: ['enterprise', 'prioritário'], notes: 'Cliente veio por indicação. Renovação automática.', priority: 'high' },
  { i: 1,  tags: ['enterprise'],               notes: 'Contrato anual. Reunião de kickoff agendada.',       priority: 'high' },
  { i: 10, tags: ['quente', 'decisor'],         notes: 'CEO decidirá até sexta-feira.',                    priority: 'high' },
  { i: 15, tags: ['prioritário'],               notes: 'Interesse confirmado. Aguardando aprovação.',      priority: 'high' },
  { i: 28, tags: ['recorrente', 'upsell'],      notes: 'Pode expandir para outros departamentos.',         priority: 'normal' },
  { i: 42, tags: ['pequeno'],                   notes: 'Interesse em plano mensal.',                       priority: 'normal' },
]

for (const e of extrasData) {
  if (leadIds[e.i]) {
    db.prepare('INSERT INTO lead_extras VALUES (?,?,?,?,?,?,?,?)').run(
      uid(), leadIds[e.i], tenantId,
      JSON.stringify(e.tags), e.notes, e.priority, '{}', now
    )
  }
}

console.log('✅ Seed concluído.')
console.log('   Tenant: Multi10 (demo)')
console.log('   Login:  admin@multi10.com / admin123')
const uniqueVendedores = new Set(leadsData.map(l => l.resp)).size
console.log(`   Leads:  ${leadsData.length} leads / ${uniqueVendedores} vendedores`)
process.exit(0)
