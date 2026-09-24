import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/* Três telas carregam com um GET e salvam de volta o que leram. Se a leitura
 * falha e a tela finge que leu, o Salvar seguinte grava vazio por cima — e leva
 * junto os segredos de n8n, que o GET nunca devolve e ninguém recupera pela
 * interface. Foi o que aconteceu na issue #94.
 *
 * A trava não é uma função isolada: são três linhas dentro do componente
 * (zerar o estado no catch, o `return` no início do save e o `disabled` do
 * botão). Como não dá para chamá-las de um teste sem um browser, este arquivo
 * vigia o código-fonte: mexer numa delas tem de ser uma decisão consciente, não
 * um efeito colateral de outra mudança.
 *
 * Se você mudou essas telas de propósito, atualize os trechos abaixo e explique
 * no commit por que a leitura que falha continua sem poder virar um Salvar. */

const raiz = process.cwd()

function fonte(caminho: string): string {
  return readFileSync(join(raiz, caminho), 'utf8')
}

test('Credenciais: falha na leitura continua travando o Salvar', () => {
  const s = fonte('app/(app)/settings/integrations/credenciais/page.tsx')

  // 1. Qualquer falha derruba o estado que autoriza o save.
  assert.match(s, /\.catch\(\(e: unknown\) => \{[\s\S]{0,400}?setLoaded\(false\)/,
    'o catch do GET precisa zerar `loaded`')
  assert.match(s, /\.catch\(\(e: unknown\) => \{[\s\S]{0,400}?setLoadedUrlKeys\(\[\]\)/,
    'o catch do GET precisa zerar `loadedUrlKeys`')

  // 2. O save desiste antes de montar o PUT.
  assert.match(s, /async function save\(\) \{[\s\S]{0,300}?if \(!loaded\) return/,
    'save() precisa sair cedo quando a leitura não deu certo')

  // 3. O botão não fica clicável nesse estado.
  assert.match(s, /disabled=\{saving \|\| !loaded\}/,
    'o botão Salvar precisa continuar desabilitado sem leitura')

  // 4. URL que nunca veio do GET e segue vazia fica fora do PUT.
  assert.match(s, /if \(campos\[k\] \|\| loadedUrlKeys\.includes\(k\)\) urls\[k\] = campos\[k\]/,
    'o PUT precisa omitir as URLs que nunca foram lidas')

  // 5. Nenhuma leitura sem conferir o status — era daí que vinha o defeito.
  assert.doesNotMatch(s, /fetch\((?![\s\S]{0,80}method)[^)]*\)\s*\.then\(\s*r\s*=>\s*r\.json\(\)\)/,
    'nenhum GET pode ir direto para r.json() sem olhar o status')
})

test('Campanha SDR: falha na leitura continua travando o Salvar', () => {
  const s = fonte('app/(app)/sdr-ia/parametros/CampaignConfig.tsx')

  assert.match(s, /\.catch\(\(e: unknown\) => \{[\s\S]{0,400}?setBaseline\(null\)/,
    'o catch do GET precisa zerar o baseline')
  assert.match(s, /async function save\(\) \{[\s\S]{0,300}?if \(baseline === null\) return/,
    'save() precisa sair cedo quando não houve leitura')
  assert.doesNotMatch(s, /fetch\((?![\s\S]{0,80}method)[^)]*\)\s*\.then\(\s*r\s*=>\s*r\.json\(\)\)/,
    'nenhum GET pode ir direto para r.json() sem olhar o status')
})

test('IA: falha na leitura continua travando o Salvar', () => {
  /* A terceira tela com a mesma forma, achada depois da issue #94: o GET traz o
   * modelo e o orçamento do cliente, e o formulário nasce nos padrões. Se a
   * leitura falhar e o Salvar continuar valendo, o PUT grava o padrão por cima do
   * que o cliente escolheu — sem erro, sem aviso, e ninguém desconfia até a
   * fatura. As duas travas abaixo já existiam e não tinham teste nenhum: dava
   * para apagar as duas e a suíte seguia verde. */
  const s = fonte('app/(app)/settings/integrations/ai/page.tsx')

  assert.match(s, /\.catch\(\(e: unknown\) => \{[^}]{0,200}setLoaded\(false\)/,
    'o catch do GET precisa zerar `loaded`')
  assert.match(s, /async function saveSettings\(\) \{[\s\S]{0,300}?if \(!loaded\) return/,
    'saveSettings() precisa sair cedo quando a leitura não deu certo')
  assert.match(s, /disabled=\{saving \|\| !loaded\}/,
    'o botão Salvar precisa continuar desabilitado sem leitura')
  // E precisa PARECER desabilitado: botão com opacidade cheia e cursor de clique
  // que não faz nada é pior do que botão apagado.
  assert.match(s, /cursor: saving \|\| !loaded \? 'not-allowed' : 'pointer'/,
    'o cursor precisa acompanhar o estado desabilitado')
  assert.match(s, /opacity: saving \|\| !loaded \? 0\.7 : 1/,
    'a opacidade precisa acompanhar o estado desabilitado')
})

test('nenhuma tela do cliente voltou a ler a resposta sem olhar o status', () => {
  // A varredura ampla do defeito B da issue #98: `.then(r => r.json())` cru
  // transforma 403 e 500 em dado. Quem precisa do corpo do erro usa fetchJson
  // (que estoura ApiError) ou confere `res.ok` na mão.
  const telas = [
    'app/(app)/dashboard/page.tsx',
    'app/(app)/dashboard/marketing/page.tsx',
    'app/(app)/sdr-ia/contatos/page.tsx',
    'app/(app)/sdr-ia/conversas/page.tsx',
    'app/(app)/sdr-ia/disparos/page.tsx',
    'app/(app)/sdr-ia/leads/page.tsx',
    'app/(app)/sdr-ia/parametros/CampaignConfig.tsx',
    'app/(app)/settings/page.tsx',
    'app/(app)/settings/integrations/ai/page.tsx',
    'app/(app)/settings/integrations/credenciais/page.tsx',
    'app/(app)/settings/integrations/sdr-source/page.tsx',
    'app/(app)/settings/integrations/ycloud/page.tsx',
    'components/AIAssistant.tsx',
    'components/integration/AdProviderPage.tsx',
    'components/leads/AddLeadForm.tsx',
    'lib/hooks/useCanDispatch.ts',
  ]
  for (const tela of telas) {
    assert.doesNotMatch(fonte(tela), /\.then\(\s*r\s*=>\s*r\.json\(\)\s*\)/,
      `${tela} voltou a tratar o corpo do erro como dado`)
  }
})
