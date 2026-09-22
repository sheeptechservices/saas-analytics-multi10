import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BRAND_STEPS,
  MIN_CONTRAST,
  brandCss,
  brandVars,
  contrastRatio,
  generateBrandScale,
  normalizeHex,
  parseHex,
  relativeLuminance,
  resolveBrandTokens,
  rgbToOklch,
  validateBrandColor,
  DEFAULT_PRIMARY,
} from '@/lib/brand'

/** As quatro cores de validação do manifesto, mais a marca em uso hoje. */
const CORES = {
  'azul escuro':      '#00224F',
  'amarelo claro':    '#FFE066', // o caso que quebrava a decisão por YIQ
  'vermelho saturado': '#D93025',
  'quase preto':      '#111111',
  'marca atual (300)': DEFAULT_PRIMARY,
}

for (const [nome, cor] of Object.entries(CORES)) {
  test(`${nome} (${cor}): o texto sobre a ação passa AA`, () => {
    const t = resolveBrandTokens(cor)
    const ratio = contrastRatio(t.action, t.contrast)
    assert.ok(
      ratio >= MIN_CONTRAST,
      `contraste ${ratio.toFixed(2)}:1 entre ${t.contrast} e ${t.action} — abaixo de ${MIN_CONTRAST}`,
    )
  })

  test(`${nome}: o texto sobre o fundo esmaecido passa AA`, () => {
    const t = resolveBrandTokens(cor)
    const ratio = contrastRatio(t.subtle, t.onSubtle)
    assert.ok(ratio >= MIN_CONTRAST, `contraste ${ratio.toFixed(2)}:1 sobre --brand-subtle`)
  })

  test(`${nome}: a escala tem ritmo perceptual regular`, () => {
    const escala = generateBrandScale(cor)
    const luzes = BRAND_STEPS.map(s => rgbToOklch(parseHex(escala[s])!).l)

    // Monotônica: cada degrau é mais escuro que o anterior.
    for (let i = 1; i < luzes.length; i++) {
      assert.ok(luzes[i] < luzes[i - 1], `degrau ${BRAND_STEPS[i]} não é mais escuro que ${BRAND_STEPS[i - 1]}`)
    }

    const passos = luzes.slice(1).map((l, i) => luzes[i] - l)

    // O topo claro é apertado de propósito (50→100 vale ~0,033 contra ~0,097 na
    // base): é onde o olho separa menos os tons. O que precisa ser uniforme é o
    // miolo, de 300 para baixo, que é onde a escala é de fato usada.
    const miolo = passos.slice(3)
    assert.ok(
      Math.max(...miolo) / Math.min(...miolo) < 1.3,
      `miolo irregular: [${miolo.map(p => p.toFixed(3)).join(' ')}]`,
    )
    // E nenhum degrau pode destoar do conjunto a ponto de virar salto.
    assert.ok(Math.max(...passos) / Math.min(...passos) < 3.2, 'algum degrau virou salto')
  })
}

test('amarelo claro não recebe texto branco — o defeito que o YIQ produzia', () => {
  const t = resolveBrandTokens('#FFE066')
  assert.notEqual(t.contrast, '#FFFFFF')
  assert.ok(contrastRatio('#FFE066', '#FFFFFF') < MIN_CONTRAST, 'premissa do caso')
})

test('cor reprovada troca pelo degrau aprovado MAIS PRÓXIMO em luminância', () => {
  // A faixa que reprova nos dois textos é estreita: com papel exige L ≤ 0,183 e
  // com tinta exige L ≥ 0,212. #7A7A7A cai no vão — 4,25:1 com papel, 4,20:1 com
  // tinta. Um cinza um pouco mais escuro, como #808080, já passa com tinta e não
  // troca nada.
  const original = '#7A7A7A'
  const t = resolveBrandTokens(original)
  assert.ok(
    Math.max(contrastRatio(original, '#FFFFFF'), contrastRatio(original, '#14181D')) < MIN_CONTRAST,
    'premissa do caso: a cor precisa reprovar nos dois',
  )
  assert.notEqual(t.action, t.primary, 'deveria ter trocado de variante')

  const lumOriginal = relativeLuminance(parseHex(original)!)
  const distanciaEscolhida = Math.abs(relativeLuminance(parseHex(t.action)!) - lumOriginal)

  // Nenhum outro degrau aprovado está mais perto do que o escolhido.
  for (const step of BRAND_STEPS) {
    const hex = generateBrandScale(original)[step]
    const passa = Math.max(contrastRatio(hex, '#FFFFFF'), contrastRatio(hex, '#14181D')) >= MIN_CONTRAST
    if (!passa) continue
    const d = Math.abs(relativeLuminance(parseHex(hex)!) - lumOriginal)
    assert.ok(d >= distanciaEscolhida - 1e-9, `degrau ${step} está mais perto que o escolhido`)
  }
})

test('a folha do servidor traz os dois conjuntos durante a transição', () => {
  const vars = brandVars('#00224F')
  for (const step of BRAND_STEPS) assert.ok(`--brand-${step}` in vars, `falta --brand-${step}`)
  for (const nome of ['--brand-action', '--brand-contrast', '--brand-subtle', '--brand-on-subtle', '--brand-focus']) {
    assert.ok(nome in vars, `falta ${nome}`)
  }
  for (const nome of ['--primary', '--primary-dim', '--primary-mid', '--primary-text', '--primary-contrast']) {
    assert.ok(nome in vars, `falta o legado ${nome}`)
  }
  assert.equal(Object.keys(vars).length, 20)
})

test('o legado continua apontando para a cor do tenant, não para a variante', () => {
  const vars = brandVars('#FFE066')
  assert.equal(vars['--primary'], '#FFE066')                       // telas antigas não mudam de cor
  assert.notEqual(vars['--primary-contrast'], '#FFFFFF')           // mas o texto sobre ela passa a ser legível
  assert.ok(contrastRatio(vars['--primary'], vars['--primary-contrast']) >= MIN_CONTRAST)
})

test('a folha não aceita nada além de cor', () => {
  const css = brandCss('#00224F; } body { display:none } :root {')
  assert.ok(!css.includes('display'), 'entrada maliciosa vazou para a folha')
  assert.ok(css.startsWith(':root{') && css.endsWith('}'))
})

test('cor ausente ou inválida cai na padrão, nunca em tema pela metade', () => {
  for (const entrada of [null, undefined, '', 'azul', '#12', '#GGGGGG']) {
    const vars = brandVars(entrada as string)
    assert.equal(vars['--primary'], DEFAULT_PRIMARY, `entrada ${JSON.stringify(entrada)}`)
    assert.equal(Object.keys(vars).length, 20)
  }
})

test('normalizeHex aceita 3 e 6 dígitos e recusa o resto', () => {
  assert.equal(normalizeHex('#abc'), '#AABBCC')
  assert.equal(normalizeHex('aabbcc'), '#AABBCC')
  assert.equal(normalizeHex('#AABBCC'), '#AABBCC')
  assert.equal(normalizeHex('#abcd'), null)
  assert.equal(normalizeHex('vermelho'), null)
  assert.equal(normalizeHex(null), null)
})

test('validateBrandColor fala português e diz quando a variante diverge', () => {
  const bom = validateBrandColor('#00224F')
  assert.equal(bom.valid, true)
  assert.equal(bom.actionDiverges, false)
  assert.ok(bom.messages.some(m => m.level === 'info'))

  const claro = validateBrandColor('#FFE066')
  assert.equal(claro.valid, true)
  assert.ok(claro.actionRatio >= MIN_CONTRAST)

  const invalido = validateBrandColor('roxo')
  assert.equal(invalido.valid, false)
  assert.equal(invalido.messages[0].level, 'error')
  assert.match(invalido.messages[0].text, /hexadecimal/i)
})
