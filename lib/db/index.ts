import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import path from 'path'
import * as schema from './schema'

const dbPath = path.join(process.cwd(), 'data', 'app.db')

const sqlite = new Database(dbPath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

try { sqlite.exec(`ALTER TABLE users ADD COLUMN photo_url TEXT`) } catch {}
try { sqlite.exec(`ALTER TABLE leads ADD COLUMN loss_reason TEXT`) } catch {}
try { sqlite.exec(`ALTER TABLE integrations ADD COLUMN selected_pipeline_id TEXT`) } catch {}
try { sqlite.exec(`ALTER TABLE integrations ADD COLUMN selected_pipeline_name TEXT`) } catch {}
try { sqlite.exec(`ALTER TABLE stages ADD COLUMN type INTEGER NOT NULL DEFAULT 0`) } catch {}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS sales_teams (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#FFB400',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS team_members (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES sales_teams(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    responsible_name TEXT NOT NULL
  );
`)

export const db = drizzle(sqlite, { schema })
export { sqlite }
