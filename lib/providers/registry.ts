// ─── Provider registry ──────────────────────────────────────────────────────────
//
// The single place where data-source providers are registered. The sync runner and
// the data-source config UI resolve providers by key from here. Adding a new
// connection type = implement DataSourceProvider, then register it below.

import type { DataSourceProvider } from './types'

const registry = new Map<string, DataSourceProvider<any, any>>()

export function registerProvider(provider: DataSourceProvider<any, any>): void {
  if (registry.has(provider.key)) {
    throw new Error(`Duplicate data-source provider key: "${provider.key}"`)
  }
  registry.set(provider.key, provider)
}

export function getProvider(key: string): DataSourceProvider<any, any> | null {
  return registry.get(key) ?? null
}

export function listProviders(): DataSourceProvider<any, any>[] {
  return [...registry.values()]
}

// ── Registrations ────────────────────────────────────────────────────────────────

import { supabaseN8nProvider } from './supabase-n8n'
registerProvider(supabaseN8nProvider)

import { yCloudProvider } from './ycloud'
registerProvider(yCloudProvider)
