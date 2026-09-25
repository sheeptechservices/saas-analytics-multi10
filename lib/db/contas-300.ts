import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db } from './index'
import { tenants, users } from './schema'
import { TENANT_ROLE } from '@/lib/roles'
import { CUSTO_BCRYPT, MIN_SENHA, validarNovaSenha } from '@/lib/senha'

/* As três contas da 300 Franchising — a parte testável do script.
 *
 * O executável é lib/db/create-users-300.ts: ele lê o ambiente, chama isto e
 * imprime o resultado. A separação existe para que lib/db/contas-300.test.ts
 * possa rodar ESTA função contra o PGlite (Postgres em memória) e provar a
 * idempotência de verdade, em vez de conferir de olho. Um arquivo que faz
 * `main().catch(...)` na avaliação do módulo não pode ser importado por teste
 * nenhum. */

export interface Conta {
  nome: string
  email: string
}

/* As três contas, confirmadas pelo dono.
 *
 * QUEM MANDA AQUI É O E-MAIL. Ele é a identidade: `users.email` é a coluna única
 * do banco, é o que a pessoa digita para entrar (auth.ts) e é por ele que este
 * script decide se a conta já existe. O nome é só o rótulo que aparece na tela —
 * o campo mais fácil de errar e o mais barato de corrigir depois, por um UPDATE
 * na coluna `name` ou pela própria pessoa em Configurações → Perfil.
 *
 * Por isso nada neste arquivo DEPENDE do nome: o id é um crypto.randomUUID(), a
 * chave de busca é o e-mail, e trocar um nome aqui não muda nenhuma linha já
 * gravada nem quebra a idempotência. */
export const CONTAS_300: readonly Conta[] = [
  { nome: 'Ricardo Oliveira',  email: 'ricardo.oliveira@300consultoria.com.br' },
  { nome: 'Yara Leite',        email: 'yara.leite@300consultoria.com.br' },
  { nome: 'Isabella Nogueira', email: 'isabella.nogueira@300consultoria.com.br' },
]

/** O tenant é procurado POR SLUG: o id é um UUID gerado em lib/db/seed-300.ts e
 *  é diferente em cada banco (o de produção não é o da cópia de teste). Id fixo
 *  no código criaria as contas penduradas num tenant que não existe, ou — pior —
 *  no tenant errado. */
export const SLUG_300 = '300'

export interface ResultadoConta {
  nome: string
  email: string
  /** 'criada' ou 'ja-existia'. Nunca 'atualizada': ver criarContas300. */
  situacao: 'criada' | 'ja-existia'
  /** Verdadeiro quando o e-mail já existe, mas preso a OUTRO cliente (ou sem
   *  cliente nenhum, caso do master). `users.email` é único no banco inteiro,
   *  então esta conta não pode ser criada na 300 e ninguém deve supor que ela
   *  está lá. */
  emOutroTenant?: boolean
}

export const ERRO_TENANT_AUSENTE =
  `Não existe nenhum cliente com slug "${SLUG_300}" neste banco. ` +
  'Confira se a DATABASE_URL aponta para o banco certo e, se for um banco novo, ' +
  'rode `npm run seed-300` antes para criar o cliente 300 Franchising.'

/**
 * Cria as contas que faltam no cliente 300 Franchising.
 *
 * IDEMPOTENTE, e o que isso significa exatamente: rodar de novo NÃO falha e NÃO
 * mexe em conta que já existe — nem na senha, nem no nome, nem no papel, nem no
 * cliente. Quem já entrou e trocou a senha não é mandado de volta para a senha
 * temporária por uma segunda execução distraída. A conta existente só é relatada
 * como 'ja-existia'.
 *
 * A conferência é pelo e-mail em minúsculas, que é como as outras portas do
 * produto gravam (app/api/users e a rota de login comparam o e-mail já
 * normalizado) e como a coluna única `users.email` guarda.
 */
export async function criarContas300(senhaTemporaria: string): Promise<ResultadoConta[]> {
  /* Mesma regra da tela e da rota: uma senha temporária que o produto recusaria
   * criaria contas que a pessoa não conseguiria confirmar ao trocar depois. */
  const problema = validarNovaSenha(senhaTemporaria)
  if (problema) {
    throw new Error(`A senha temporária não serve: ${problema} (mínimo de ${MIN_SENHA}).`)
  }

  const tenant = await db
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .where(eq(tenants.slug, SLUG_300))
    .then(r => r[0])

  if (!tenant) throw new Error(ERRO_TENANT_AUSENTE)

  const resultados: ResultadoConta[] = []

  for (const conta of CONTAS_300) {
    const email = conta.email.toLowerCase().trim()

    const existente = await db
      .select({ id: users.id, tenantId: users.tenantId })
      .from(users)
      .where(eq(users.email, email))
      .then(r => r[0])

    if (existente) {
      resultados.push({
        nome: conta.nome,
        email,
        situacao: 'ja-existia',
        emOutroTenant: existente.tenantId !== tenant.id,
      })
      continue
    }

    /* O hash é calculado por conta, e não uma vez fora do laço, porque cada
     * bcrypt gera o próprio salt: três hashes idênticos no banco contariam para
     * quem os lesse que as três senhas são a mesma. */
    await db.insert(users).values({
      id: crypto.randomUUID(),
      tenantId: tenant.id,
      name: conta.nome,
      email,
      passwordHash: await bcrypt.hash(senhaTemporaria, CUSTO_BCRYPT),
      // Conta única (lib/roles.ts): todo usuário de cliente é 'admin'. O valor
      // sai de TENANT_ROLE, o mesmo que app/api/users/route.ts grava.
      role: TENANT_ROLE,
      // As mesmas cores que o convite pela interface aplica, para que estas três
      // contas não fiquem visivelmente diferentes das criadas pela tela Equipe.
      avatarColor: '#FFB400',
      avatarBg: '#121316',
      createdAt: new Date(),
    })

    resultados.push({ nome: conta.nome, email, situacao: 'criada' })
  }

  return resultados
}
