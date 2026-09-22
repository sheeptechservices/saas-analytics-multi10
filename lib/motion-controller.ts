'use client';

/**
 * lib/motion-controller.ts — um único requestAnimationFrame por tela.
 *
 * Por que existe: re-renderizar o React a 60fps para animar entrada e morph
 * desperdiça reconciliação em uma árvore de centenas de nós. Aqui os valores
 * são escritos direto no DOM — variável CSS para geometria, textContent para
 * número — e o React re-renderiza apenas duas vezes: ao iniciar e ao encerrar.
 *
 * Consequência para o lint: nenhum valor animado passa por atributo `style` em
 * JSX, então a proibição de estilo inline vale sem exceção. O componente declara
 * a variável na classe Tailwind, por exemplo `w-[var(--v)]` ou
 * `[stroke-dashoffset:var(--v)]`, e o controlador só escreve a variável.
 *
 * Entrada (seção 5.10), teto de 680ms para o conjunto:
 *   KPI    500ms, escalonamento de 60ms, contagem de 0 ao valor
 *   Funil  400ms, escalonamento de 50ms
 *   Donut  500ms, escalonamento de 40ms, varredura horária desde as 12 horas
 *   Rótulo e variação entram nos últimos 120ms do próprio bloco
 *
 * Morph de valor: 300ms, do valor antigo ao novo, sem replay da entrada.
 */

export const ENTRANCE = {
  kpi: { duration: 500, stagger: 60 },
  funnel: { duration: 400, stagger: 50 },
  donut: { duration: 500, stagger: 40 },
  labelFade: 120,
  cap: 680,
} as const;

export const MORPH_MS = 300;

/** Contagem legível antes da metade da duração: em p=0,5 mostra 96,9%. */
const easeCount = (p: number): number => 1 - Math.pow(1 - p, 5);
/** Curva padrão do sistema, equivalente a cubic-bezier(0.2, 0, 0, 1). */
const easeStandard = (p: number): number => 1 - Math.pow(1 - p, 3);

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const nowMs = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

export type Track = {
  /** Elemento que recebe a escrita. */
  el: HTMLElement | SVGElement | null;
  /** Valor final. */
  to: number;
  /** Valor inicial. Entrada usa 0; morph usa o valor exibido antes. */
  from?: number;
  /** Atraso em ms dentro do conjunto. */
  delay?: number;
  /** Duração em ms. */
  duration?: number;
  /** Curva: contagem (padrão) ou padrão do sistema. */
  ease?: 'count' | 'standard';
  /**
   * Como escrever. `text` formata e escreve em textContent;
   * `var` escreve uma variável CSS com o valor já formatado em unidade.
   */
  write:
    | { kind: 'text'; format: (v: number) => string }
    | { kind: 'var'; name: string; format: (v: number) => string };
};

export type Fade = {
  el: HTMLElement | SVGElement | null;
  /** Início do fade: por padrão os últimos 120ms do bloco. */
  delay: number;
  duration?: number;
};

type RunOptions = {
  tracks: Track[];
  fades?: Fade[];
  /** Teto do conjunto. Nada se move depois dele. */
  cap?: number;
  onDone?: () => void;
};

function applyTrack(track: Track, value: number): void {
  const el = track.el;
  if (!el) return;
  if (track.write.kind === 'text') {
    el.textContent = track.write.format(value);
  } else {
    el.style.setProperty(track.write.name, track.write.format(value));
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Executa um conjunto de trilhas em um só laço. Devolve a função de cancelamento.
 * Sob prefers-reduced-motion, escreve o estado final e não abre laço.
 */
export function runMotion({ tracks, fades = [], cap = ENTRANCE.cap, onDone }: RunOptions): () => void {
  const settle = (): void => {
    tracks.forEach((t) => applyTrack(t, t.to));
    fades.forEach((f) => f.el?.style.setProperty('opacity', '1'));
    onDone?.();
  };

  if (prefersReducedMotion()) {
    settle();
    return () => {};
  }

  fades.forEach((f) => f.el?.style.setProperty('opacity', '0'));
  const t0 = nowMs();
  let raf = 0;
  let cancelled = false;

  const frame = (): void => {
    if (cancelled) return;
    const elapsed = nowMs() - t0;

    for (const track of tracks) {
      const delay = track.delay ?? 0;
      const duration = track.duration ?? ENTRANCE.kpi.duration;
      const p = clamp01((elapsed - delay) / duration);
      const eased = (track.ease === 'standard' ? easeStandard : easeCount)(p);
      const from = track.from ?? 0;
      applyTrack(track, from + (track.to - from) * eased);
    }

    for (const fade of fades) {
      const duration = fade.duration ?? ENTRANCE.labelFade;
      const p = clamp01((elapsed - fade.delay) / duration);
      fade.el?.style.setProperty('opacity', p.toFixed(3));
    }

    if (elapsed >= cap) {
      settle();
      return;
    }
    raf = requestAnimationFrame(frame);
  };

  raf = requestAnimationFrame(frame);
  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
    settle();
  };
}

/** Trilhas da entrada de um bloco de KPIs. */
export function kpiTracks(
  items: { valueEl: HTMLElement | null; barEl?: HTMLElement | null; to: number; format: (v: number) => string }[],
): { tracks: Track[]; fades: (el: HTMLElement | null, index: number) => Fade } {
  const tracks: Track[] = [];
  items.forEach((item, i) => {
    const delay = i * ENTRANCE.kpi.stagger;
    tracks.push({
      el: item.valueEl,
      to: item.to,
      delay,
      duration: ENTRANCE.kpi.duration,
      write: { kind: 'text', format: item.format },
    });
    if (item.barEl) {
      tracks.push({
        el: item.barEl,
        to: 1,
        delay,
        duration: ENTRANCE.kpi.duration,
        /* sparkline desenhando: pathLength=1, dasharray=1, offset de 1 a 0 */
        write: { kind: 'var', name: '--v', format: (v) => (1 - v).toFixed(3) },
      });
    }
  });
  return {
    tracks,
    fades: (el, index) => ({
      el,
      delay: index * ENTRANCE.kpi.stagger + ENTRANCE.kpi.duration - ENTRANCE.labelFade,
    }),
  };
}

/** Morph de valor: 300ms, do exibido ao novo, com a curva padrão do sistema. */
export function morphTracks(
  items: { el: HTMLElement | null; from: number; to: number; write: Track['write'] }[],
): Track[] {
  return items.map((item) => ({
    el: item.el,
    from: item.from,
    to: item.to,
    duration: MORPH_MS,
    ease: 'standard',
    write: item.write,
  }));
}
