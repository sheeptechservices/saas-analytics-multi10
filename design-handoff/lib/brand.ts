/**
 * lib/brand.ts — única fonte de verdade para a cor de marca do tenant.
 *
 * Substitui as duas funções conflitantes que existiam antes
 * (`applyPrimaryVars` em stores/whiteLabelStore.ts e o helper duplicado em
 * app/(app)/settings/page.tsx), que decidiam contraste por luminância YIQ.
 * Aqui o contraste é calculado pela relação WCAG 2.1 real, com mínimo de 4.5:1.
 *
 * A escala é gerada em Oklch: matiz preservada, luminância percentual fixa por
 * degrau e croma reduzido até caber no gamut sRGB. Isso mantém a escala
 * coerente com marca vermelha, verde, roxa, preta ou amarela clara.
 *
 * Nenhum valor de cor deste arquivo é usado como estado, alerta ou dado.
 */

export type Rgb = { r: number; g: number; b: number };
export type Oklch = { l: number; c: number; h: number };

export const BRAND_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export type BrandStep = (typeof BRAND_STEPS)[number];
export type BrandScale = Record<BrandStep, string>;

/** Texto escuro de referência: --color-neutral-900. */
export const INK = '#14181D';
/** Texto claro de referência: --color-neutral-0. */
export const PAPER = '#FFFFFF';
/** Mínimo WCAG AA para texto normal. */
export const MIN_CONTRAST = 4.5;

/* ────────────────────────────── hex ↔ rgb ───────────────────────────── */

/** Aceita `#abc`, `abc`, `#aabbcc` e `aabbcc`. Retorna null se inválido. */
export function parseHex(input: string): Rgb | null {
  const hex = input.trim().replace(/^#/, '').toLowerCase();
  if (!/^[0-9a-f]{3}$/.test(hex) && !/^[0-9a-f]{6}$/.test(hex)) return null;
  const full = hex.length === 3 ? hex.replace(/./g, (ch) => ch + ch) : hex;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

const byteToHex = (v: number): string =>
  Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');

export function toHex({ r, g, b }: Rgb): string {
  return `#${byteToHex(r)}${byteToHex(g)}${byteToHex(b)}`.toUpperCase();
}

/* ─────────────────────── contraste WCAG 2.1 real ─────────────────────── */

const toLinear = (channel: number): number => {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

/** Luminância relativa WCAG (0 = preto, 1 = branco). */
export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Relação de contraste WCAG entre duas cores (1:1 a 21:1). */
export function contrastRatio(a: Rgb | string, b: Rgb | string): number {
  const ca = typeof a === 'string' ? parseHex(a) : a;
  const cb = typeof b === 'string' ? parseHex(b) : b;
  if (!ca || !cb) return 1;
  const la = relativeLuminance(ca);
  const lb = relativeLuminance(cb);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Escolhe entre tinta e papel o texto com maior contraste sobre `background`.
 * Nunca há `#fff` ou `#000` fixo sobre a marca: todo consumidor lê
 * `--brand-contrast` ou `--brand-on-subtle`, definidos por esta função.
 */
export function pickAccessibleText(
  background: string,
  candidates: readonly string[] = [INK, PAPER],
): { color: string; ratio: number; passesAA: boolean } {
  let best = { color: candidates[0], ratio: 0 };
  for (const candidate of candidates) {
    const ratio = contrastRatio(background, candidate);
    if (ratio > best.ratio) best = { color: candidate, ratio };
  }
  return { ...best, passesAA: best.ratio >= MIN_CONTRAST };
}

/* ───────────────────────────── sRGB ↔ Oklch ──────────────────────────── */

export function rgbToOklch(rgb: Rgb): Oklch {
  const r = toLinear(rgb.r);
  const g = toLinear(rgb.g);
  const b = toLinear(rgb.b);

  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const c = Math.sqrt(A * A + B * B);
  const h = c < 1e-6 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

function oklchToRgbRaw({ l, c, h }: Oklch): { rgb: Rgb; inGamut: boolean } {
  const rad = (h * Math.PI) / 180;
  const A = c * Math.cos(rad);
  const B = c * Math.sin(rad);

  const l_ = l + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = l - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = l - 0.0894841775 * A - 1.291485548 * B;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  const lr = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const lg = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const lb = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;

  const toSrgb = (v: number): number =>
    v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;

  const channels = [toSrgb(lr), toSrgb(lg), toSrgb(lb)];
  const inGamut = channels.every((v) => v >= -0.001 && v <= 1.001);
  return {
    rgb: { r: channels[0] * 255, g: channels[1] * 255, b: channels[2] * 255 },
    inGamut,
  };
}

/** Converte Oklch em sRGB reduzindo o croma por bisseção até caber no gamut. */
export function oklchToRgb(color: Oklch): Rgb {
  const direct = oklchToRgbRaw(color);
  if (direct.inGamut) return direct.rgb;

  let lo = 0;
  let hi = color.c;
  let result = oklchToRgbRaw({ ...color, c: 0 }).rgb;
  for (let i = 0; i < 20; i += 1) {
    const mid = (lo + hi) / 2;
    const attempt = oklchToRgbRaw({ ...color, c: mid });
    if (attempt.inGamut) {
      result = attempt.rgb;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return result;
}

/* ────────────────────────── escala de marca ─────────────────────────── */

/** Luminância Oklch alvo por degrau. Fixa: garante ritmo igual para toda marca. */
const STEP_LIGHTNESS: Record<BrandStep, number> = {
  50: 0.972,
  100: 0.938,
  200: 0.884,
  300: 0.812,
  400: 0.726,
  500: 0.642,
  600: 0.558,
  700: 0.472,
  800: 0.384,
  900: 0.286,
};

/** Croma relativo ao croma da cor recebida. Extremos dessaturam. */
const STEP_CHROMA: Record<BrandStep, number> = {
  50: 0.2,
  100: 0.34,
  200: 0.54,
  300: 0.74,
  400: 0.9,
  500: 1,
  600: 0.96,
  700: 0.86,
  800: 0.72,
  900: 0.56,
};

/**
 * Gera os 10 tons a partir da cor primária do tenant.
 * Marca preta ou branca produz escala neutra coerente (croma ≈ 0).
 */
export function generateBrandScale(primary: string): BrandScale {
  const rgb = parseHex(primary) ?? parseHex('#3474FF')!;
  const base = rgbToOklch(rgb);
  /* Marcas quase acromáticas ganham um piso de croma para não virar cinza puro
     sem intenção; marcas saturadas mantêm o croma medido. */
  const baseChroma = base.c < 0.012 ? base.c : Math.min(base.c, 0.32);

  const scale = {} as BrandScale;
  for (const step of BRAND_STEPS) {
    scale[step] = toHex(
      oklchToRgb({
        l: STEP_LIGHTNESS[step],
        c: baseChroma * STEP_CHROMA[step],
        h: base.h,
      }),
    );
  }
  return scale;
}

/* ─────────────────────────── tokens de marca ────────────────────────── */

export type BrandTokens = {
  scale: BrandScale;
  /** Cor recebida do tenant, usada no logo e como referência do anel de foco. */
  primary: string;
  /** Fundo do botão primário e do item ativo sólido: variante que passa AA. */
  action: string;
  /** Texto sobre `action`, por contraste WCAG real. */
  contrast: string;
  /** Fundo tintado do item ativo de navegação. */
  subtle: string;
  /** Texto sobre `subtle`, por contraste WCAG real. */
  onSubtle: string;
  /** Anel de foco. */
  focus: string;
};

/**
 * Deriva os tokens finais. Se a cor recebida não alcança 4.5:1 com tinta nem
 * com papel, a variante de ação troca pelo degrau APROVADO MAIS PRÓXIMO em
 * luminância — não pelo primeiro de uma ordem fixa. Isso mantém o desvio no
 * menor valor possível, para que a diferença pareça ajuste de contraste e não
 * outra cor: um cinza médio vira o vizinho imediato, nunca um salto de família.
 */
export function resolveBrandTokens(primary: string): BrandTokens {
  const normalized = parseHex(primary) ? toHex(parseHex(primary)!) : '#3474FF';
  const scale = generateBrandScale(normalized);

  const direct = pickAccessibleText(normalized);
  let action = normalized;
  let contrast = direct.color;

  if (!direct.passesAA) {
    const originLum = relativeLuminance(parseHex(normalized)!);
    const approved = BRAND_STEPS.map((step) => {
      const hex = scale[step];
      const text = pickAccessibleText(hex);
      return {
        step,
        hex,
        text,
        distance: Math.abs(relativeLuminance(parseHex(hex)!) - originLum),
      };
    })
      .filter((c) => c.text.passesAA)
      .sort((a, b) => a.distance - b.distance);

    if (approved.length > 0) {
      action = approved[0].hex;
      contrast = approved[0].text.color;
    }
  }

  const subtle = scale[50];
  const onSubtleCandidates = [scale[900], scale[800], scale[700], INK];
  const onSubtle =
    onSubtleCandidates.find((c) => contrastRatio(subtle, c) >= MIN_CONTRAST) ?? INK;

  const rgb = parseHex(normalized)!;
  return {
    scale,
    primary: normalized,
    action,
    contrast,
    subtle,
    onSubtle,
    focus: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.45)`,
  };
}

/** Escreve os tokens de marca no elemento raiz. Único ponto de escrita. */
export function applyBrandTokens(
  primary: string,
  root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement,
): BrandTokens {
  const tokens = resolveBrandTokens(primary);
  if (!root) return tokens;
  for (const step of BRAND_STEPS) {
    root.style.setProperty(`--brand-${step}`, tokens.scale[step]);
  }
  root.style.setProperty('--brand-action', tokens.action);
  root.style.setProperty('--brand-contrast', tokens.contrast);
  root.style.setProperty('--brand-subtle', tokens.subtle);
  root.style.setProperty('--brand-on-subtle', tokens.onSubtle);
  root.style.setProperty('--brand-focus', tokens.focus);
  return tokens;
}

/* ──────────────── validação para o formulário de Marca ──────────────── */

export type BrandValidation = {
  valid: boolean;
  /** Cor normalizada em 6 dígitos, ou null quando o hex é inválido. */
  normalized: string | null;
  ratioOnPaper: number;
  ratioOnInk: number;
  /** True quando a cor recebida já serve de fundo de botão sem ajuste. */
  usableAsAction: boolean;
  /** Variante efetivamente usada no botão primário. */
  action: string | null;
  contrast: string | null;
  /** True quando a variante de ação difere da cor informada. */
  actionDiverges: boolean;
  /** Contraste alcançado pela variante de ação, para exibir no formulário. */
  actionRatio: number;
  /** Mensagens prontas para exibição, em português do Brasil. */
  messages: { level: 'error' | 'warning' | 'info'; text: string }[];
};

export function validateBrandColor(input: string): BrandValidation {
  const rgb = parseHex(input);
  if (!rgb) {
    return {
      valid: false,
      normalized: null,
      ratioOnPaper: 1,
      ratioOnInk: 1,
      usableAsAction: false,
      action: null,
      contrast: null,
      actionDiverges: false,
      actionRatio: 1,
      messages: [{ level: 'error', text: 'Informe uma cor em hexadecimal de 3 ou 6 dígitos.' }],
    };
  }

  const normalized = toHex(rgb);
  const tokens = resolveBrandTokens(normalized);
  const ratioOnPaper = contrastRatio(normalized, PAPER);
  const ratioOnInk = contrastRatio(normalized, INK);
  const usableAsAction = Math.max(ratioOnPaper, ratioOnInk) >= MIN_CONTRAST;

  const messages: BrandValidation['messages'] = [];
  if (!usableAsAction) {
    messages.push({
      level: 'warning',
      text: `Esta cor não alcança contraste 4,5:1 com texto claro nem escuro. O botão primário usa ${tokens.action}, o tom aprovado mais próximo da sua cor. O logo e o anel de foco continuam em ${normalized}.`,
    });
  }
  if (contrastRatio(normalized, '#F4F6F8') < 1.35) {
    messages.push({
      level: 'warning',
      text: 'A cor é muito próxima do fundo da aplicação. O item ativo da navegação pode ficar difícil de perceber.',
    });
  }
  if (usableAsAction && messages.length === 0) {
    messages.push({
      level: 'info',
      text: `Contraste aprovado: ${Math.max(ratioOnPaper, ratioOnInk).toFixed(2)}:1 com ${
        ratioOnPaper >= ratioOnInk ? 'texto claro' : 'texto escuro'
      }.`,
    });
  }

  return {
    valid: true,
    normalized,
    ratioOnPaper,
    ratioOnInk,
    usableAsAction,
    action: tokens.action,
    contrast: tokens.contrast,
    actionDiverges: tokens.action !== normalized,
    actionRatio: contrastRatio(tokens.action, tokens.contrast),
    messages,
  };
}
