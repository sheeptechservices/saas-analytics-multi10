import { createClient, type Client, type Config } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from './schema'

/* Importar este módulo NÃO abre conexão nem toca disco.
 *
 * Era esse o defeito que derrubou o deploy na Railway: o cliente nascia na
 * avaliação do módulo, e `createClient` com URL `file:` abre o arquivo na hora
 * da construção — não espera a primeira consulta. Durante o "collecting page
 * data" do `next build`, o Next importa cada rota; sem TURSO_DATABASE_URL no
 * ambiente, a URL caía no `file:./data/app.db`, o diretório não existia na
 * imagem e o build morria com SQLITE_CANTOPEN.
 *
 * Agora `db` e `client` são fachadas preguiçosas: o cliente real só nasce no
 * primeiro acesso a uma propriedade, ou seja, dentro do handler que vai
 * consultar — nunca na importação. */

function urlDoBanco(): string {
  /* `trim` porque variável de ambiente com espaço sobrando é truthy: sem isso,
   * '   ' passaria direto e o erro viria do driver, sem dizer o que arrumar. */
  const url = process.env.TURSO_DATABASE_URL?.trim()
  if (url) return url

  /* Em produção, cair no arquivo local é pior do que falhar: o app subiria
   * apontando para um banco vazio e efêmero, e ninguém veria o erro. Aqui a
   * falha é explícita — e no primeiro uso, não na importação, para o build
   * continuar passando sem as variáveis. */
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'TURSO_DATABASE_URL não está definida. Em produção o banco é o Turso: ' +
        'defina TURSO_DATABASE_URL (e TURSO_AUTH_TOKEN) nas variáveis de ambiente ' +
        'do serviço. O arquivo local ./data/app.db vale só em desenvolvimento e nos testes.',
    )
  }
  return 'file:./data/app.db'
}

const configDoCliente = (): Config => ({
  url: urlDoBanco(),
  authToken: process.env.TURSO_AUTH_TOKEN,
})

function novoCliente(): Client {
  return createClient(configDoCliente())
}

function novoDb(cliente: Client) {
  return drizzle(cliente, { schema })
}

type Db = ReturnType<typeof novoDb>

/* Os dois ficam no globalThis. Em desenvolvimento o HMR reavalia este módulo a
 * cada edição e, sem isto, cada recarga deixava para trás um cliente com o seu
 * pool de conexões — o processo acumulava vários falando com o mesmo banco. */
const escopoGlobal = globalThis as typeof globalThis & {
  __tursoClient?: Client
  __tursoDb?: Db
}

/* `??=` só atribui quando a fábrica retorna: se `urlDoBanco` lançar, nada fica
 * guardado e a próxima chamada tenta de novo (o ambiente pode ter sido
 * corrigido entre uma requisição e outra). */
function obterCliente(): Client {
  return (escopoGlobal.__tursoClient ??= novoCliente())
}

function obterDb(): Db {
  return (escopoGlobal.__tursoDb ??= novoDb(obterCliente()))
}

/**
 * Fachada preguiçosa: repassa tudo para o objeto real, criado no primeiro
 * acesso. Método sai amarrado ao real (`bind`) porque tanto o cliente do libsql
 * quanto o drizzle guardam estado em campo privado — com `this` apontando para
 * o Proxy, a leitura desse campo falharia.
 */
function fachadaPreguicosa<T extends object>(obter: () => T): T {
  return new Proxy({} as T, {
    get(_alvo, propriedade) {
      const real = obter()
      const valor = Reflect.get(real, propriedade, real)
      return typeof valor === 'function' ? valor.bind(real) : valor
    },
    set(_alvo, propriedade, valor) {
      return Reflect.set(obter(), propriedade, valor)
    },
    has(_alvo, propriedade) {
      return Reflect.has(obter(), propriedade)
    },
  })
}

export const db: Db = fachadaPreguicosa(obterDb)
export const client: Client = fachadaPreguicosa(obterCliente)
