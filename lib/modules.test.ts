import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALL_MODULE_KEYS, HIDDEN_MODULE_KEYS, MODULES, firstAllowedPath, isModuleHidden, moduleKeyForPath,
} from '@/lib/modules'

// Rotas que só redirecionam: as telas ocultas (lib/hidden-route.ts).
const HIDDEN_PATHS = MODULES.filter(m => isModuleHidden(m.key)).map(m => m.path)

// Todas as combinações de módulos — mais uma chave fora do catálogo: módulos que
// saíram do produto seguem gravados em tenant_modules de tenants antigos e não
// podem atrapalhar.
const LEGADA = 'integration.removida'
function* subsets(keys: string[]): Generator<string[]> {
  for (let mask = 0; mask < 1 << keys.length; mask++) {
    yield keys.filter((_, i) => mask & (1 << i))
  }
}
const KEYS = [...ALL_MODULE_KEYS, LEGADA]

test('Pipeline e Ranking estão ocultos, com as chaves mantidas para a reconstrução', () => {
  assert.deepEqual([...HIDDEN_MODULE_KEYS].sort(), ['dashboard.ranking', 'pipeline'])
  assert.ok(ALL_MODULE_KEYS.includes('pipeline'))
  assert.ok(ALL_MODULE_KEYS.includes('dashboard.ranking'))
  assert.deepEqual([...HIDDEN_PATHS].sort(), ['/dashboard/ranking', '/pipeline'])
})

test('firstAllowedPath nunca devolve tela oculta nem rota que o layout redirecionaria', () => {
  let casos = 0
  for (const modules of subsets(KEYS)) {
    const path = firstAllowedPath(modules)
    const onde = `módulos [${modules.join(', ')}] → ${path}`
    assert.ok(!HIDDEN_PATHS.includes(path), `tela oculta: ${onde}`)
    // o layout de (app) redireciona quando o módulo da rota não está liberado —
    // e redireciona para firstAllowedPath de novo: seria um laço
    const required = moduleKeyForPath(path)
    assert.ok(required === null || modules.includes(required), `exige ${required}: ${onde}`)
    casos++
  }
  assert.equal(casos, 2 ** KEYS.length)
})

test('tenant cuja única tela era Pipeline ou Ranking cai em Configurações', () => {
  assert.equal(firstAllowedPath(['pipeline']), '/settings')
  assert.equal(firstAllowedPath(['dashboard.ranking']), '/settings')
  assert.equal(firstAllowedPath(['pipeline', 'dashboard.ranking', LEGADA]), '/settings')
  assert.equal(firstAllowedPath([]), '/settings')
})

test('as demais telas continuam com a mesma prioridade', () => {
  assert.equal(firstAllowedPath(['dashboard.ranking', 'dashboard.overview']), '/dashboard')
  assert.equal(firstAllowedPath(['dashboard.ranking', 'dashboard.marketing']), '/dashboard/marketing')
  assert.equal(firstAllowedPath(['pipeline', 'sdr.dashboard']), '/sdr-ia/disparos')
  assert.equal(firstAllowedPath(['sdr.dashboard', 'sdr.parametros']), '/sdr-ia/disparos')
  // só sdr.parametros: /sdr-ia/disparos exigiria sdr.dashboard (antes, laço)
  assert.equal(firstAllowedPath(['sdr.parametros']), '/sdr-ia/leads')
})

test('as rotas ocultas continuam mapeadas ao seu módulo', () => {
  assert.equal(moduleKeyForPath('/pipeline'), 'pipeline')
  assert.equal(moduleKeyForPath('/dashboard/ranking'), 'dashboard.ranking')
})
