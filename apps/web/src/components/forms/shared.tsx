import { X } from 'lucide-react';
import type { ReactNode } from 'react';

/** Moldura comum dos formulários. */
export function Dialog({
  title,
  subtitle,
  onClose,
  children,
  wide,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 p-4 pt-[8vh]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={
          wide
            ? 'card max-h-[84vh] w-full max-w-2xl overflow-auto p-5 shadow-xl'
            : 'card max-h-[84vh] w-full max-w-md overflow-auto p-5 shadow-xl'
        }
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-semibold">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-[var(--color-muted)]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-[var(--color-faint)]">{hint}</span>}
    </label>
  );
}

export const formInputClass =
  'w-full rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-text)] outline-none transition-colors placeholder:text-[var(--color-faint)] focus:border-[var(--color-teal)]';

/**
 * Entrada de dinheiro em pt-BR.
 *
 * Aceita só dígito, vírgula e ponto. Bloquear o resto na digitação evita o erro
 * mais comum de formulário financeiro: a pessoa digita "R$ 1.200" e o parse
 * silencioso devolve 1 real e vinte, ou NaN.
 */
export function MoneyInput({
  value,
  onChange,
  placeholder = '0,00',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <span className="num pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[12px] text-[var(--color-faint)]">
        R$
      </span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/[^\d.,]/g, ''))}
        placeholder={placeholder}
        className={`${formInputClass} num pl-9`}
      />
    </div>
  );
}

/**
 * `1.234,56` -> 123456 centavos.
 *
 * O ponto sai como separador de milhar e a vírgula vira decimal — a ordem
 * importa, senão "1.200" viraria 1,20.
 */
export function parseMoney(value: string): number {
  const normalized = value.replace(/\./g, '').replace(',', '.').trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}
