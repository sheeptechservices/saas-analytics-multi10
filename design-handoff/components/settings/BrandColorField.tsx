'use client';

/**
 * components/settings/BrandColorField.tsx — campo de cor primária do tenant.
 *
 * Mostra as DUAS amostras sempre que a variante de ação difere da cor informada:
 * a cor da marca (logo e anel de foco) e a cor do botão (contraste aprovado).
 * Sem isso, o cliente vê um botão numa cor que não escolheu e conclui que é bug.
 *
 * Toda cor vem de lib/brand.ts. Nenhum hexadecimal é escrito aqui.
 */

import { useMemo, useState } from 'react';
import { validateBrandColor } from '@/lib/brand';

type Props = {
  value: string;
  onChange: (hex: string) => void;
  /** Nome do tenant, usado na pré-visualização do item ativo. */
  brandName: string;
};

const LEVEL_CLASS = {
  error: 'bg-danger-bg border-danger-border text-danger-text',
  warning: 'bg-warning-bg border-warning-border text-warning-text',
  info: 'bg-success-bg border-success-border text-success-text',
} as const;

export function BrandColorField({ value, onChange, brandName }: Props) {
  const [draft, setDraft] = useState(value);
  const validation = useMemo(() => validateBrandColor(draft), [draft]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label
          htmlFor="brand-color"
          className="font-mono text-11 uppercase tracking-[0.06em] text-text-secondary"
        >
          Cor primária
        </label>
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="size-control shrink-0 rounded-control border border-border-strong bg-brand-500"
          />
          <input
            id="brand-color"
            type="text"
            inputMode="text"
            spellCheck={false}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              const next = validateBrandColor(e.target.value);
              if (next.valid && next.normalized) onChange(next.normalized);
            }}
            placeholder="#00224F"
            className="h-control w-36 rounded-control border border-border-strong bg-surface-card px-3 font-mono text-13 text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-focus"
          />
          <span className="font-mono text-12 text-text-muted">3 ou 6 dígitos</span>
        </div>
      </div>

      {/* As duas amostras. A segunda só aparece quando há divergência. */}
      <div className="flex flex-wrap gap-3">
        <figure className="flex min-w-56 flex-1 flex-col gap-2 rounded-panel border border-border-hairline bg-surface-card p-4">
          <span className="font-mono text-11 uppercase tracking-[0.06em] text-text-secondary">
            Marca — logo e anel de foco
          </span>
          <span
            aria-hidden="true"
            className="h-10 rounded-control border border-border-hairline bg-brand-500"
          />
          <figcaption className="font-mono text-12 text-text-muted">
            {validation.normalized ?? '—'}
          </figcaption>
        </figure>

        {validation.actionDiverges ? (
          <figure className="flex min-w-56 flex-1 flex-col gap-2 rounded-panel border border-warning-border bg-surface-card p-4">
            <span className="font-mono text-11 uppercase tracking-[0.06em] text-warning-text">
              Botão primário — contraste aprovado
            </span>
            <span
              aria-hidden="true"
              className="h-10 rounded-control border border-border-hairline bg-brand-action"
            />
            <figcaption className="font-mono text-12 text-text-muted">
              {validation.action} · {validation.actionRatio.toFixed(2)}:1
            </figcaption>
          </figure>
        ) : null}
      </div>

      {/* Pré-visualização real: botão, item ativo, texto e superfície. */}
      <div className="flex flex-col gap-3 rounded-panel border border-border-hairline bg-surface-page p-4">
        <span className="font-mono text-11 uppercase tracking-[0.06em] text-text-secondary">
          Pré-visualização
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="h-control rounded-control bg-brand-action px-4 text-14 font-medium text-brand-contrast focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-focus"
          >
            Criar disparo
          </button>
          <span className="flex h-9 items-center gap-2 rounded-control bg-brand-subtle px-3 text-13 font-medium text-brand-on-subtle">
            {brandName}
          </span>
          <span className="text-14 text-text-primary">Texto sobre superfície</span>
        </div>
      </div>

      {validation.messages.map((message) => (
        <p
          key={message.text}
          role={message.level === 'error' ? 'alert' : undefined}
          className={`rounded-control border px-3 py-2 text-13 leading-body ${LEVEL_CLASS[message.level]}`}
        >
          {message.text}
        </p>
      ))}

      <p className="text-12 leading-body text-text-secondary">
        Contraste com texto claro {validation.ratioOnPaper.toFixed(2)}:1 · com texto escuro{' '}
        {validation.ratioOnInk.toFixed(2)}:1. O mínimo exigido é 4,5:1, medido pela relação WCAG,
        e a cor do tenant nunca é usada para estado, alerta ou dado.
      </p>
    </div>
  );
}
