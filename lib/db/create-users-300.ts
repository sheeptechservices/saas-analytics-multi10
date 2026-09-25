/**
 * Script de uma vez só: cria as três contas da 300 Franchising (slug "300").
 *
 * Uso:
 *   USERS_300_PASSWORD='<senha temporária>' npm run create-users-300
 *
 * A senha vem SÓ do ambiente. Não existe argumento de linha de comando para ela
 * — o que se digita no terminal fica no histórico do shell, e o `ps` de qualquer
 * usuário da máquina lê a linha de comando de um processo alheio enquanto ele
 * roda. Também não existe valor padrão no código: senha literal em arquivo
 * versionado é senha pública. (Os scripts vizinhos, lib/db/seed-300.ts e
 * lib/db/create-master.ts, têm padrões literais; é justamente o que não se repete
 * aqui.)
 *
 * E este script NÃO IMPRIME A SENHA, ao contrário daqueles dois: ela iria para o
 * terminal, para o scrollback e para o log do CI. Quem rodou o comando já a
 * conhece — foi quem a escolheu.
 *
 * Rodar duas vezes é seguro: ver criarContas300 em ./contas-300.
 */

import { loadEnv } from './load-env'
loadEnv()
/* O cliente vem de ./index através de ./contas-300: ele lê DATABASE_URL só no
 * PRIMEIRO USO, nunca na importação — então o loadEnv() acima já rodou quando
 * main() consulta. De quebra, o script herda a configuração do pool e a decisão
 * de TLS do app, em vez de repetir uma conexão solta aqui. */
import { CONTAS_300, criarContas300 } from './contas-300'

const VAR_SENHA = 'USERS_300_PASSWORD'

async function main() {
  /* Sem trim() no valor usado: espaço no começo ou no fim pode fazer parte da
   * senha, e apará-lo gravaria um hash de outra coisa que a pessoa digitou.
   * O trim serve só para decidir se a variável está, na prática, vazia — é o
   * mesmo critério de lib/db/index.ts para a DATABASE_URL.
   * (load-env.ts já apara o que vem de .env.local; aqui o cuidado é com a
   * variável exportada direto no shell.) */
  const senha = process.env[VAR_SENHA] ?? ''
  if (!senha.trim()) {
    console.error(`❌ Falta a variável de ambiente ${VAR_SENHA}.`)
    console.error(`   Ela leva a senha temporária das três contas. Defina-a no ambiente`)
    console.error(`   (ou em .env.local) e rode de novo — nunca passe a senha como`)
    console.error(`   argumento na linha de comando: ela ficaria no histórico do shell.`)
    process.exit(1)
  }

  const resultados = await criarContas300(senha)

  for (const r of resultados) {
    if (r.situacao === 'criada') {
      console.log(`✅ Criada:     ${r.nome} <${r.email}>`)
    } else if (r.emOutroTenant) {
      console.warn(`⚠️  Já existia: <${r.email}> — mas em OUTRO cliente. Nada foi alterado,`)
      console.warn(`               e esta conta NÃO pertence à 300 Franchising.`)
    } else {
      console.log(`ℹ️  Já existia: ${r.nome} <${r.email}> — senha e dados preservados.`)
    }
  }

  const criadas = resultados.filter(r => r.situacao === 'criada').length
  const emOutro = resultados.filter(r => r.emOutroTenant).length
  console.log('')
  console.log('─────────────────────────────────────────────────────')
  /* "as demais já existiam" é tranquilizador, e seria mentira quando um e-mail está
   * preso a OUTRO cliente: ali a pessoa não está na 300 e ninguém a colocou lá. O
   * aviso detalhado sai acima; o resumo não pode contradizê-lo. */
  console.log(
    emOutro > 0
      ? `${criadas} de ${CONTAS_300.length} contas criadas agora. ` +
        `ATENÇÃO: ${emOutro} e-mail(s) pertencem a outro cliente e NÃO entraram na 300 — veja os avisos acima.`
      : `${criadas} de ${CONTAS_300.length} contas criadas agora; as demais já existiam.`,
  )
  console.log('Próximos passos:')
  console.log('  1. Envie a senha temporária a cada pessoa por um canal privado.')
  console.log('     (Ela não é impressa aqui de propósito.)')
  console.log('  2. Peça que cada uma troque a senha no primeiro acesso, em')
  console.log('     Configurações → Perfil → Senha.')
  console.log('─────────────────────────────────────────────────────')

  process.exit(0)
}

main().catch(err => {
  // Mensagem limpa para o erro esperado (cliente ausente, senha curta); pilha
  // inteira para o inesperado, que é o que precisa ser depurado.
  if (err instanceof Error) console.error(`❌ ${err.message}`)
  else console.error(err)
  process.exit(1)
})
