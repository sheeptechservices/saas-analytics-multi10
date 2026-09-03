import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'
import jsxA11y from 'eslint-plugin-jsx-a11y'

const __dirname = dirname(fileURLToPath(import.meta.url))
const compat = new FlatCompat({ baseDirectory: __dirname })

// ─── O que é erro e o que é aviso ─────────────────────────────────────────────
//
// O repositório inteiro nasceu com estilo em linha e hexadecimal solto no JSX.
// Transformar isso em erro de uma vez pararia o build e ninguém conseguiria
// trabalhar. Então as mesmas regras valem em dois níveis: aviso no código legado,
// erro nos arquivos já migrados para o design system novo.
//
// A lista abaixo começa vazia de propósito. Cada tela migrada entra aqui no mesmo
// commit da migração — a partir daí, regressão nela quebra o build.
const MIGRADOS = []

const MSG_STYLE =
  'Estilo em linha não entra: use classe do design system. O valor inline vence a folha e mata hover e foco.'
const MSG_HEX =
  'Hexadecimal solto não entra no JSX: use var(--token). Cor fora do token não acompanha tema nem marca do cliente.'
const MSG_MOUSE =
  'onMouseEnter/Leave/Over/Out não entram: use :hover no CSS, que funciona por teclado e toque também.'
const MSG_FOCO =
  'Estado de foco escrito em JavaScript. Use :focus-visible; o anel vem de --brand-focus.'

const SELETOR_STYLE = { selector: "JSXAttribute[name.name='style']", message: MSG_STYLE }
const SELETOR_MOUSE = {
  selector: "JSXAttribute[name.name=/^onMouse(Enter|Leave|Over|Out)$/]",
  message: MSG_MOUSE,
}
// Portado do eslint.config.mjs do pacote de redesenho: pega onFocus/onBlur que
// escrevem em element.style, que é hover em JavaScript com outro nome.
const SELETOR_FOCO = {
  selector:
    'JSXAttribute[name.name=/^on(Focus|Blur)$/] > JSXExpressionContainer ArrowFunctionExpression AssignmentExpression[left.property.name="style"]',
  message: MSG_FOCO,
}
// Cobre '#fff' e "#FFB400" em literal e o mesmo dentro de template string.
const SELETORES_HEX = [
  { selector: "Literal[value=/#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?\\b/]", message: MSG_HEX },
  { selector: "TemplateElement[value.raw=/#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?\\b/]", message: MSG_HEX },
]

/** Recebe as regras de um preset e devolve as mesmas no nível pedido. */
function comNivel(rules, nivel) {
  return Object.fromEntries(
    Object.entries(rules).map(([nome, valor]) => [
      nome,
      Array.isArray(valor) ? [nivel, ...valor.slice(1)] : nivel,
    ]),
  )
}

/**
 * Rebaixa erro para aviso, preservando o que já era aviso e o que está desligado.
 *
 * Os presets do Next chegam com 77 erros no código de hoje (no-explicit-any,
 * no-unescaped-entities, no-empty-object-type). Como o gate do build reprova em
 * erro, deixá-los como estão significaria build vermelho desde o primeiro dia e
 * ninguém trabalhando. Erro é reservado para a lista de migrados, que começa vazia.
 */
function apenasAvisos(rules) {
  return Object.fromEntries(
    Object.entries(rules).map(([nome, valor]) => {
      const nivel = Array.isArray(valor) ? valor[0] : valor
      const ehErro = nivel === 2 || nivel === 'error'
      if (!ehErro) return [nome, valor]
      return [nome, Array.isArray(valor) ? ['warn', ...valor.slice(1)] : 'warn']
    }),
  )
}

const REGRAS_A11Y = jsxA11y.flatConfigs.recommended.rules

export default [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'drizzle/**',
      'public/**',
      'next-env.d.ts',
      // Cópias inteiras do repositório criadas por agentes — lintar aqui é lintar
      // o mesmo código nove vezes, com o estado de outra branch.
      '.claude/worktrees/**',
      // Pacote do redesenho ainda em espera: entra no lint quando for integrado.
      'design-handoff/**',
    ],
  },

  ...compat
    .extends('next/core-web-vitals', 'next/typescript')
    .map(config => (config.rules ? { ...config, rules: apenasAvisos(config.rules) } : config)),

  // ── Legado: as mesmas regras, em nível de aviso ─────────────────────────────
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: { 'jsx-a11y': jsxA11y },
    rules: {
      ...comNivel(REGRAS_A11Y, 'warn'),
      'no-restricted-syntax': ['warn', SELETOR_STYLE, SELETOR_MOUSE, SELETOR_FOCO],
    },
  },
  {
    // Hexadecimal é regra de .tsx: em .ts a cor mora em lib/brand.ts, que é a
    // fonte dos tokens e por isso fica de fora.
    files: ['**/*.tsx'],
    ignores: ['lib/brand.ts'],
    rules: {
      'no-restricted-syntax': ['warn', SELETOR_STYLE, SELETOR_MOUSE, SELETOR_FOCO, ...SELETORES_HEX],
    },
  },

  // ── Migrado: as mesmas regras, em nível de erro (quebra o build) ────────────
  ...(MIGRADOS.length > 0
    ? [{
        files: MIGRADOS,
        ignores: ['lib/brand.ts'],
        plugins: { 'jsx-a11y': jsxA11y },
        rules: {
          ...comNivel(REGRAS_A11Y, 'error'),
          'no-restricted-syntax': ['error', SELETOR_STYLE, SELETOR_MOUSE, SELETOR_FOCO, ...SELETORES_HEX],
        },
      }]
    : []),
]
