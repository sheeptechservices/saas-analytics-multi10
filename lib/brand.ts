// Cor da marca do tenant → variáveis CSS.
//
// Uma conta só, usada nos dois lados: o servidor imprime as variáveis no HTML da
// primeira resposta (nada de marca padrão piscando antes da marca do cliente), e o
// cliente reaplica as mesmas quando o admin troca a cor na tela de configurações.
//
// Este é o único arquivo .ts onde hexadecimal literal é esperado — é aqui que a cor
// padrão mora, e é daqui que todo o resto deriva.

export const DEFAULT_PRIMARY    = '#E10504'
export const DEFAULT_BRAND_NAME = '300 Franchising'

const HEX6 = /^#?[0-9a-fA-F]{6}$/

/** Normaliza para '#rrggbb'. Devolve null quando a cor não serve. */
export function normalizeHex(color: string | null | undefined): string | null {
  const raw = String(color ?? '').trim()
  if (!HEX6.test(raw)) return null
  return '#' + raw.replace('#', '').toLowerCase()
}

/**
 * As cinco variáveis derivadas da primária. Chave = nome da variável CSS.
 * Cor inválida cai na padrão, para nunca devolver um tema pela metade.
 */
export function brandVars(color: string | null | undefined): Record<string, string> {
  const hex = normalizeHex(color) ?? DEFAULT_PRIMARY
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)

  // Luminância decide se o texto sobre a primária é claro ou escuro.
  const contrast = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? '#121316' : '#FFFFFF'

  // Texto da marca sobre fundo esmaecido: a mesma cor multiplicada por ~0.55.
  const escurecer = (v: number) => Math.round(v * 0.55).toString(16).padStart(2, '0')
  const primaryText = `#${escurecer(r)}${escurecer(g)}${escurecer(b)}`

  return {
    '--primary':          hex,
    '--primary-dim':      `rgba(${r},${g},${b},0.12)`,
    '--primary-mid':      `rgba(${r},${g},${b},0.40)`,
    '--primary-text':     primaryText,
    '--primary-contrast': contrast,
  }
}

/**
 * As mesmas variáveis como folha de estilo, para o servidor mandar junto com o HTML.
 * Só caracteres de cor entram no texto (brandVars normaliza), então não há injeção
 * possível pelo valor gravado no banco.
 */
export function brandCss(color: string | null | undefined): string {
  const decls = Object.entries(brandVars(color))
    .map(([nome, valor]) => `${nome}:${valor}`)
    .join(';')
  return `:root{${decls}}`
}
