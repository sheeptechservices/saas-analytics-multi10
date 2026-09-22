'use client';

/**
 * lib/hooks/useChartMotion.ts — os dois únicos comportamentos de movimento
 * permitidos em gráfico.
 *
 * 1. Entrada: acontece no máximo uma vez por sessão e por período do dia.
 *    A decisão vem do atributo data-animate escrito antes da primeira pintura.
 * 2. Morph de valor: troca de período, filtro aplicado ou dado atualizado
 *    transitam do valor antigo ao novo em 300ms. Nunca é replay da entrada e
 *    não consome o teto.
 */

import { useEffect, useRef, useState } from 'react';
import { MORPH_DURATION_MS, entranceEnabled, prefersReducedMotion } from '@/lib/animation-gate';

/**
 * True apenas quando esta sessão ganhou o direito de animar a entrada.
 * Começa em false para que o HTML do servidor e o primeiro frame do cliente
 * sejam idênticos — o estado final.
 */
export function useEntranceMotion(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(entranceEnabled());
  }, []);
  return enabled;
}

/**
 * Interpola de um valor ao outro quando `target` muda. O primeiro render já
 * devolve `target`: navegação e retorno a uma tela visitada não animam.
 */
export function useValueMorph(target: number, duration: number = MORPH_DURATION_MS): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target || prefersReducedMotion()) {
      fromRef.current = target;
      setValue(target);
      return;
    }

    let start = 0;
    const step = (ts: number): void => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      /* mesma curva do sistema: cubic-bezier(0.2, 0, 0, 1) aproximada */
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(from + (target - from) * eased);
      if (p < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = target;
      }
    };

    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      fromRef.current = target;
    };
  }, [target, duration]);

  return value;
}
