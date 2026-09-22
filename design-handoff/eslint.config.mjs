import js from '@eslint/js';
import next from 'eslint-config-next';
import react from 'eslint-plugin-react';
import jsxA11y from 'eslint-plugin-jsx-a11y';

/**
 * eslint.config.mjs — as quatro regras que sustentam o redesenho.
 *
 * Estratégia de adoção: override por caminho. Arquivo migrado é erro, arquivo
 * legado é aviso. A lista MIGRATED cresce a cada tela entregue, e o CI só quebra
 * no que já foi refeito — nunca no que ainda espera a vez.
 *
 * Regras:
 *   1. Zero estilo inline           react/forbid-dom-props (style)
 *   2. Zero hexadecimal solto       no-restricted-syntax sobre Literal
 *   3. Zero hover em JavaScript     no-restricted-syntax sobre JSXAttribute
 *   4. Acessibilidade               jsx-a11y (recommended + foco visível)
 *
 * Nota sobre a regra 1: não há exceção para largura de barra nem para
 * strokeDashoffset. Com lib/motion-controller.ts esses valores são escritos por
 * ref (element.style.setProperty) e nunca aparecem como atributo `style` em JSX,
 * então a proibição vale sem furos. Se algum caso legítimo surgir, a saída é
 * uma variável CSS declarada no componente, não uma exceção na regra.
 */

/** Arquivos já migrados para os tokens novos. Cresce por entrega. */
const MIGRATED = [
  /* Fundação — Entrega 0 */
  'app/globals.css',
  'lib/brand.ts',
  'lib/animation-gate.ts',
  'lib/motion-controller.ts',
  'lib/hooks/useChartMotion.ts',
  'app/animation-gate-script.ts',
  'stores/whiteLabelStore.ts',

  /* Entrega 1 — Login */
  'app/(auth)/layout.tsx',
  'app/(auth)/login/**',
  'app/(auth)/forgot-password/**',
  'app/(auth)/reset-password/**',
  'components/auth/**',
  'middleware.ts',

  /* Entrega 2 — Visão geral */
  'app/(app)/dashboard/page.tsx',
  'components/dashboard/**',
  'components/layout/**',
  'components/ui/**',
  'components/widgets/**',

  /* Entrega 3 — Conversas */
  'app/(app)/sdr-ia/conversas/**',
  'components/conversations/**',

  /* Próximas entregas entram aqui, uma linha por tela:
     'app/(app)/leads/**', 'components/leads/**',            // Entrega 4
     'app/(app)/sdr-ia/disparos/**', 'components/blast/**',  // Entrega 6
     'app/(app)/ia/**', 'components/ai/**',                  // Entrega 7
     'app/(app)/settings/**', 'components/settings/**',      // Entrega 10
     'app/(master)/**',                                      // Entrega 11 */
];

/** Onde hexadecimal é a própria fonte de verdade. */
const HEX_ALLOWED = ['app/globals.css', 'lib/brand.ts'];

const noInlineStyle = {
  'react/forbid-dom-props': ['error', { forbid: ['style'] }],
};

const noRawHex = {
  'no-restricted-syntax': [
    'error',
    {
      selector: 'Literal[value=/#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b/]',
      message:
        'Hexadecimal fora do arquivo de tokens. Use uma variável do bloco @theme (app/globals.css) ou um token semântico.',
    },
    {
      selector: 'TemplateElement[value.raw=/#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b/]',
      message: 'Hexadecimal interpolado. Use uma variável do bloco @theme.',
    },
  ],
};

const noJsHover = {
  'no-restricted-syntax': [
    'error',
    {
      selector:
        'JSXAttribute[name.name=/^on(MouseEnter|MouseLeave|MouseOver|MouseOut)$/]',
      message:
        'Hover em JavaScript. Use :hover em classe Tailwind ou CSS. Handlers de mouse só para gesto real (arrastar, desenhar, medir).',
    },
    {
      selector: 'JSXAttribute[name.name=/^on(Focus|Blur)$/] > JSXExpressionContainer ArrowFunctionExpression AssignmentExpression[left.property.name="style"]',
      message:
        'Estado de foco escrito em JavaScript. Use :focus-visible; o anel vem de --brand-focus.',
    },
  ],
};

/** As três regras que mudam de severidade por caminho. */
function severity(level) {
  const map = (rule) =>
    Object.fromEntries(
      Object.entries(rule).map(([name, value]) => [
        name,
        Array.isArray(value) ? [level, ...value.slice(1)] : level,
      ]),
    );
  return { ...map(noInlineStyle), ...map(noRawHex), ...map(noJsHover) };
}

export default [
  js.configs.recommended,
  ...next,

  {
    files: ['**/*.{ts,tsx}'],
    plugins: { react, 'jsx-a11y': jsxA11y },
    rules: {
      ...jsxA11y.configs.recommended.rules,
      /* Todo elemento interativo precisa de foco visível e alvo de teclado. */
      'jsx-a11y/no-static-element-interactions': 'error',
      'jsx-a11y/click-events-have-key-events': 'error',
      'jsx-a11y/interactive-supports-focus': 'error',
      'jsx-a11y/label-has-associated-control': 'error',
      /* Rótulo em maiúsculas via CSS, não via texto: mantém o leitor de tela legível. */
      'jsx-a11y/anchor-is-valid': 'error',
    },
  },

  /* Legado: as três regras avisam, não quebram o build. */
  {
    files: ['**/*.{ts,tsx}'],
    rules: severity('warn'),
  },

  /* Migrado: as três regras são erro. */
  {
    files: MIGRATED.filter((p) => !p.endsWith('.css')),
    rules: severity('error'),
  },

  /* Onde o hexadecimal é a fonte de verdade. */
  {
    files: HEX_ALLOWED.filter((p) => !p.endsWith('.css')),
    rules: { 'no-restricted-syntax': 'off' },
  },

  {
    ignores: ['.next/**', 'node_modules/**', 'drizzle/**', 'data/**', 'next-env.d.ts'],
  },
];
