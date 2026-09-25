/* Conferência do ambiente, uma vez, no arranque do servidor.
 *
 * O Next chama `register()` quando o servidor sobe — `next start` e `next dev`,
 * um `prepare()` por processo. O que ele NÃO faz é chamá-lo durante o
 * `next build`: há uma guarda explícita em
 * `next/dist/server/lib/router-utils/instrumentation-globals.external.js` que
 * sai cedo quando `NEXT_PHASE === 'phase-production-build'`, e o `next build`
 * define essa variável antes de abrir os processos que coletam os dados das
 * páginas. `lib/instrumentacao.test.ts` prova isso rodando o módulo real do
 * Next instalado, nos dois cenários.
 *
 * Isso importa mais do que parece. Um `register()` que estoura derruba o
 * processo inteiro — é o mesmo apagão que a criação do cliente de banco na
 * importação do módulo já causou uma vez, só que num disfarce novo. A CI
 * constrói de propósito sem nenhuma variável de banco
 * (.github/workflows/ci.yml, job "build de produção"), e é ela quem continua
 * provando que este arquivo não quebrou o `next build`.
 *
 * Por isso a decisão de rodar ou não fica em `modoDeVerificacao()`, que olha
 * dois sinais independentes do ambiente do build e é testada sozinha.
 *
 * Este arquivo é de propósito curto e sem lógica: tudo que dá para errar mora em
 * `lib/ambiente.ts`, onde tem teste. */

import {
  conferirAmbiente,
  modoDeVerificacao,
  textoDaFalhaDeAmbiente,
} from '@/lib/ambiente'

export async function register(): Promise<void> {
  /* Literal, e não `env.NEXT_RUNTIME`, porque o Next substitui exatamente esta
   * expressão em tempo de compilação (next/dist/build/define-env.js). No pacote
   * da borda ela vira a constante 'edge' e o empacotador apaga o resto da função
   * — nenhuma dessas linhas chega a existir lá. Lido pelo objeto `process.env`,
   * o nome simplesmente não estaria definido em tempo de execução no edge, e a
   * conferência rodaria duas vezes, uma delas fora de hora.
   *
   * Existe um `instrumentation` de borda porque existe `middleware.ts`; o
   * ambiente que interessa conferir é o do servidor Node, onde moram o banco, a
   * criptografia e o envio de e-mail. */
  if (process.env.NEXT_RUNTIME === 'edge') return

  const modo = modoDeVerificacao(process.env)
  if (modo === 'ignorar') return

  const { erros, avisos } = conferirAmbiente(process.env, modo === 'exigir')

  for (const aviso of avisos) console.warn('[ambiente] atenção:', aviso)

  if (erros.length === 0) return

  if (modo === 'exigir') {
    /* Estourar aqui derruba o arranque de propósito: em produção, subir com o
     * ambiente errado significa servir erro por erro a cada requisição, cada um
     * apontando para um lugar diferente. Melhor não abrir a porta e deixar a
     * hospedagem mostrar uma mensagem só, com a lista inteira. */
    throw new Error(textoDaFalhaDeAmbiente(erros))
  }

  /* Fora de produção a mesma lista vira aviso. Quem está montando o ambiente
   * local não pode ser impedido de subir o servidor pela metade — é assim que se
   * descobre o que falta. */
  console.warn(textoDaFalhaDeAmbiente(erros))
}
