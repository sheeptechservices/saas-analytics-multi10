import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MASTER_ROLE,
  TENANT_ROLE,
  canActInTenant,
  isMasterRole,
  isTenantRole,
  roleLabel,
  sharesTenant,
} from '@/lib/roles'

// Conta única: dentro do cliente não há hierarquia. O que estes testes seguram é
// justamente a parte perigosa da mudança — a linha legada ('manager', 'user') tem
// que passar sem a migração ter rodado, e o isolamento entre tenants não pode
// afrouxar junto.

const PAPEIS_LEGADOS = ['manager', 'user']

test('o master continua sendo o papel da plataforma', () => {
  assert.equal(MASTER_ROLE, 'master')
  assert.equal(isMasterRole('master'), true)
  assert.equal(isMasterRole('admin'), false)
  assert.equal(isMasterRole(null), false)
  assert.equal(isMasterRole(undefined), false)
})

test('toda conta nova de cliente nasce admin', () => {
  assert.equal(TENANT_ROLE, 'admin')
})

test('papel legado é usuário do tenant, sem a migração ter rodado', () => {
  assert.equal(isTenantRole('admin'), true)
  for (const papel of PAPEIS_LEGADOS) {
    assert.equal(isTenantRole(papel), true, `${papel} deveria valer como usuário do tenant`)
    assert.equal(canActInTenant(papel), true, `${papel} deveria passar na porta do tenant`)
  }
})

test('o master não é usuário de tenant, mas age dentro de qualquer um', () => {
  assert.equal(isTenantRole('master'), false)
  assert.equal(canActInTenant('master'), true)
})

test('sem papel, a checagem falha fechada', () => {
  for (const vazio of [null, undefined, '', '   ']) {
    assert.equal(isTenantRole(vazio), false)
    assert.equal(canActInTenant(vazio), false)
  }
})

test('papel desconhecido no banco ainda é usuário do tenant, nunca master', () => {
  // Se alguém gravar qualquer outra coisa na coluna, o acesso é o do cliente —
  // o que não pode acontecer é virar master por acidente.
  assert.equal(isTenantRole('supervisor'), true)
  assert.equal(isMasterRole('supervisor'), false)
})

test('isolamento: usuário do cliente só alcança o próprio tenant', () => {
  for (const papel of ['admin', ...PAPEIS_LEGADOS]) {
    const ator = { role: papel, tenantId: 'tenant-a' }
    assert.equal(sharesTenant(ator, 'tenant-a'), true, `${papel} deveria ver o próprio tenant`)
    assert.equal(sharesTenant(ator, 'tenant-b'), false, `${papel} não pode ver outro tenant`)
  }
})

test('isolamento: o master atravessa tenants, como já atravessava', () => {
  const master = { role: 'master', tenantId: 'tenant-a' }
  assert.equal(sharesTenant(master, 'tenant-b'), true)
  assert.equal(sharesTenant(master, null), true)
})

test('a etiqueta na tela não mente sobre o acesso da linha legada', () => {
  // A Topbar mostrava "Gerente"/"Usuário" para quem pode tudo, e o cartão do
  // Perfil imprimia o valor cru da coluna ("MANAGER"). São duas etiquetas agora.
  assert.equal(roleLabel('master'), 'Master')
  assert.equal(roleLabel('admin'), 'Administrador')
  assert.equal(roleLabel('manager'), 'Administrador')
  assert.equal(roleLabel('user'), 'Administrador')
  assert.equal(roleLabel('supervisor'), 'Administrador')
  assert.equal(roleLabel(null), '')
  assert.equal(roleLabel(undefined), '')
  assert.equal(roleLabel(''), '')
})

test('a etiqueta de master só sai para quem é master', () => {
  // Quem decide o que a UI libera é isMasterRole; a etiqueta tem que concordar.
  for (const papel of ['admin', 'manager', 'user', '', null]) {
    assert.equal(isMasterRole(papel), false)
    assert.notEqual(roleLabel(papel), 'Master')
  }
})

test('isolamento: tenant faltando dos dois lados não vira permissão', () => {
  assert.equal(sharesTenant({ role: 'admin', tenantId: null }, 'tenant-a'), false)
  assert.equal(sharesTenant({ role: 'admin', tenantId: 'tenant-a' }, null), false)
  assert.equal(sharesTenant({ role: 'admin', tenantId: null }, null), false)
  assert.equal(sharesTenant({}, undefined), false)
})
