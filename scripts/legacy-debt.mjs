/**
 * Conta o que ainda depende do bloco LEGADO de app/globals.css.
 *
 * É o número que encolhe a cada tela migrada. Quando zerar, o bloco LEGADO sai
 * do globals.css e o Passo 12 do handoff está cumprido.
 *
 *   npm run debt          resumo
 *   npm run debt -- --por-arquivo   detalhe por arquivo
 */

import { execSync } from 'node:child_process'

const VARIAVEIS = [
  '--bg', '--white', '--black', '--gray', '--gray2', '--gray3',
  '--primary', '--primary-dim', '--primary-mid', '--primary-text', '--primary-contrast',
  '--red', '--green',
  '--radius-sm', '--radius-md', '--radius-lg',
  '--shadow', '--shadow-sm', '--shadow-md', '--shadow-lg',
  '--transition', '--ink', '--ink-2', '--muted', '--line',
]

const CLASSES = [
  'animate-slide-up', 'animate-fade-in', 'animate-slide-right',
  'delay-1', 'delay-2', 'delay-3', 'delay-4', 'delay-5', 'delay-6', 'delay-7', 'delay-8', 'delay-9',
  'shimmer-bar', 'live-dot', 'animate-count-pop', 'tabular-nums', 'btn-pulse', 'blast-dot', 'row-cascade',
  'bg-primary', 'text-primary', 'border-primary', 'bg-primary-dim', 'border-primary-mid',
  'text-primary-text', 'ring-primary',
  'btn', 'btn-primary', 'btn-secondary', 'btn-ghost', 'btn-success', 'btn-danger',
  'btn-sm', 'btn-md', 'btn-lg',
]

const ALVOS = ['app', 'components', 'lib', 'stores']

function ocorrencias(padrao) {
  // git grep sai com 1 quando não acha nada, e o shell do Windows não entende
  // `|| true` — então o "sem resultado" vem por exceção, não por saída vazia.
  let saida = ''
  try {
    saida = execSync(`git grep -o -F -e "${padrao}" -- ${ALVOS.join(' ')}`, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch (err) {
    if (err.status !== 1) throw err
  }
  const linhas = saida.split('\n').filter(Boolean)
  const arquivos = new Map()
  for (const l of linhas) {
    const arq = l.split(':')[0]
    arquivos.set(arq, (arquivos.get(arq) ?? 0) + 1)
  }
  return { usos: linhas.length, arquivos }
}

const detalhe = process.argv.includes('--por-arquivo')
const porArquivo = new Map()
let totalVars = 0
let totalClasses = 0

for (const v of VARIAVEIS) {
  const { usos, arquivos } = ocorrencias(`var(${v})`)
  totalVars += usos
  for (const [a, n] of arquivos) porArquivo.set(a, (porArquivo.get(a) ?? 0) + n)
}

for (const c of CLASSES) {
  // Só conta a classe como palavra inteira dentro de className/class.
  const { usos, arquivos } = ocorrencias(`"${c}`)
  const { usos: u2, arquivos: a2 } = ocorrencias(` ${c}"`)
  totalClasses += usos + u2
  for (const [a, n] of [...arquivos, ...a2]) porArquivo.set(a, (porArquivo.get(a) ?? 0) + n)
}

const arquivosTocados = [...porArquivo.keys()].length

console.log('Dívida do bloco LEGADO (app/globals.css)')
console.log('─'.repeat(46))
console.log(`  variáveis var(--x) ......... ${String(totalVars).padStart(5)}`)
console.log(`  classes do legado .......... ${String(totalClasses).padStart(5)}`)
console.log(`  total ...................... ${String(totalVars + totalClasses).padStart(5)}`)
console.log(`  arquivos que ainda dependem  ${String(arquivosTocados).padStart(5)}`)

if (detalhe) {
  console.log('\nPor arquivo:')
  for (const [arq, n] of [...porArquivo].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${arq}`)
  }
}
