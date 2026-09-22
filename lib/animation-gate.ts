/**
 * lib/animation-gate.ts — quando animar a entrada de um gráfico.
 *
 * Regra: uma vez por sessão, com teto de uma vez por período do dia.
 * O controle é por sessão e por slot, não por gráfico: se o dashboard animou,
 * todas as telas daquela sessão já entram no estado final.
 *
 * O período é calculado sempre em America/Sao_Paulo, nunca no fuso do
 * dispositivo. O período da noite atravessa a meia-noite e pertence à data em
 * que começou: 01:00 do dia 12 é o slot 2026-09-11:noite.
 *
 * A decisão de verdade acontece antes da primeira pintura, no script inline de
 * app/animation-gate-script.ts. Este módulo é a fonte da lógica e o que o
 * cliente consulta depois da hidratação.
 */

export type DayPeriod = 'manha' | 'tarde' | 'noite';

export const SESSION_KEY = 'libero.animated.session';
export const SLOT_KEY = 'libero.animated.slot';
export const TIME_ZONE = 'America/Sao_Paulo';

/** Duração do morph de valor. Exceção deliberada ao teto de 250ms do sistema. */
export const MORPH_DURATION_MS = 300;

type SaoPauloClock = { year: number; month: number; day: number; hour: number };

/** Ano, mês, dia e hora em America/Sao_Paulo, independentemente do dispositivo. */
export function saoPauloClock(now: Date = new Date()): SaoPauloClock {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);

  /* hourCycle h23 pode devolver 24 na virada; normaliza para 0. */
  const hour = get('hour') % 24;
  return { year: get('year'), month: get('month'), day: get('day'), hour };
}

export function periodOf(hour: number): DayPeriod {
  if (hour >= 5 && hour < 12) return 'manha';
  if (hour >= 12 && hour < 18) return 'tarde';
  return 'noite';
}

const pad = (v: number): string => String(v).padStart(2, '0');

/**
 * Slot atual no formato YYYY-MM-DD:periodo.
 * Entre 00:00 e 04:59 a data recua um dia, porque a noite pertence ao dia em
 * que começou.
 */
export function currentSlot(now: Date = new Date()): string {
  const { year, month, day, hour } = saoPauloClock(now);
  const period = periodOf(hour);

  let y = year;
  let m = month;
  let d = day;
  if (period === 'noite' && hour < 5) {
    const shifted = new Date(Date.UTC(year, month - 1, day));
    shifted.setUTCDate(shifted.getUTCDate() - 1);
    y = shifted.getUTCFullYear();
    m = shifted.getUTCMonth() + 1;
    d = shifted.getUTCDate();
  }

  return `${y}-${pad(m)}-${pad(d)}:${period}`;
}

/* ─────────────────────────── armazenamento ─────────────────────────── */

type SafeStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Acesso tolerante a falha. Em modo privado ou com armazenamento bloqueado,
 * devolve null — e o padrão seguro passa a ser o estado final, sem animação.
 */
function storage(kind: 'session' | 'local'): SafeStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    const store = kind === 'session' ? window.sessionStorage : window.localStorage;
    const probe = '__libero_probe__';
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Decide se a entrada deve animar. Não escreve nada: quem confirma é commitAnimated,
 * chamado pelo script pré-pintura no mesmo instante da decisão.
 */
export function shouldAnimateEntrance(now: Date = new Date()): boolean {
  if (prefersReducedMotion()) return false;

  const session = storage('session');
  const local = storage('local');
  if (!session || !local) return false;

  if (session.getItem(SESSION_KEY) === '1') return false;
  return local.getItem(SLOT_KEY) !== currentSlot(now);
}

/** Marca a sessão e o slot como já animados. */
export function commitAnimated(now: Date = new Date()): void {
  const session = storage('session');
  const local = storage('local');
  if (!session || !local) return;
  session.setItem(SESSION_KEY, '1');
  local.setItem(SLOT_KEY, currentSlot(now));
}

/**
 * Estado resolvido para o cliente: lê o atributo escrito antes da primeira
 * pintura. Não recalcula, para que a virada de período com a sessão aberta não
 * reanime — o teto só é reavaliado em uma sessão nova.
 */
export function entranceEnabled(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset.animate === 'on';
}
