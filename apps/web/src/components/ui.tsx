import clsx from 'clsx';
import type { ReactNode } from 'react';

/* -------------------------------------------------------------------------- */
/*  Card                                                                      */
/* -------------------------------------------------------------------------- */

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return <div className={clsx('card', padded && 'p-5', className)}>{children}</div>;
}

export function CardTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-[15px] font-semibold text-[var(--color-text)]">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-[var(--color-muted)]">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Badge                                                                     */
/* -------------------------------------------------------------------------- */

export type Tone = 'positive' | 'negative' | 'warning' | 'neutral' | 'accent';

const TONE_CLASSES: Record<Tone, string> = {
  positive: 'bg-[var(--color-positive-soft)] text-[var(--color-positive)]',
  negative: 'bg-[var(--color-negative-soft)] text-[var(--color-negative)]',
  warning: 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]',
  neutral: 'bg-[var(--color-surface-sunken)] text-[var(--color-muted)]',
  accent: 'bg-[var(--color-teal-soft)] text-[var(--color-teal)]',
};

export function Badge({
  children,
  tone = 'neutral',
  mono = true,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  mono?: boolean;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium',
        mono && 'num',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  StatTile — o KPI da visao geral                                           */
/* -------------------------------------------------------------------------- */

export function StatTile({
  label,
  value,
  badge,
  badgeTone = 'neutral',
  caption,
  valueTone,
}: {
  label: string;
  value: string;
  badge?: string;
  badgeTone?: Tone;
  caption?: string;
  valueTone?: 'positive' | 'negative' | 'warning';
}) {
  const valueColor =
    valueTone === 'positive'
      ? 'text-[var(--color-positive)]'
      : valueTone === 'negative'
        ? 'text-[var(--color-negative)]'
        : valueTone === 'warning'
          ? 'text-[var(--color-warning)]'
          : 'text-[var(--color-text)]';

  return (
    <div className="card flex flex-col justify-between p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <span className="text-xs leading-snug font-medium text-[var(--color-muted)]">{label}</span>
        {badge && (
          <Badge tone={badgeTone} className="mt-px">
            {badge}
          </Badge>
        )}
      </div>
      <div className={clsx('num text-[26px] leading-none font-semibold', valueColor)}>{value}</div>
      {caption && <p className="mt-3 text-xs text-[var(--color-muted)]">{caption}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Barra de progresso                                                        */
/* -------------------------------------------------------------------------- */

export type ProgressStatus = 'ON_TRACK' | 'WARNING' | 'EXCEEDED' | null;

const PROGRESS_COLORS: Record<'ON_TRACK' | 'WARNING' | 'EXCEEDED', string> = {
  ON_TRACK: 'var(--color-positive)',
  WARNING: 'var(--color-warning)',
  EXCEEDED: 'var(--color-negative)',
};

/**
 * A cor da barra codifica ESTADO (no trilho / atencao / estourado), nao a
 * identidade da categoria. Cor por categoria aqui obrigaria o usuario a
 * consultar uma legenda para descobrir se um gasto e um problema.
 */
export function Progress({
  value,
  status,
  color,
  className,
  height = 4,
}: {
  /** 0-100+. Acima de 100 a barra satura e o estado vira EXCEEDED. */
  value: number;
  status?: ProgressStatus;
  /** Sobrescreve a cor de estado — usado quando a barra e so magnitude. */
  color?: string;
  className?: string;
  height?: number;
}) {
  const fill = color ?? (status ? PROGRESS_COLORS[status] : 'var(--color-positive)');
  return (
    <div
      className={clsx('w-full overflow-hidden rounded-full bg-[var(--color-line)]', className)}
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${Math.min(Math.max(value, 0), 100)}%`, background: fill }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Controles de filtro                                                       */
/* -------------------------------------------------------------------------- */

/** Segmentado claro (3 meses | 6 meses | 12 meses). */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-0.5 rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={clsx(
              'rounded-[6px] px-3 py-1.5 text-xs font-medium transition-colors',
              active
                ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                : 'text-[var(--color-muted)] hover:text-[var(--color-text)]',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Chips de escopo (Todas | Cartao | Conta corrente | Parceladas). */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex items-center gap-2">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={clsx(
              'rounded-[var(--radius-control)] px-3.5 py-2 text-xs font-medium whitespace-nowrap transition-colors',
              active
                ? 'bg-[var(--color-ink)] text-white'
                : 'border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-line-strong)]',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tabela                                                                    */
/* -------------------------------------------------------------------------- */

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('w-full overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = 'left',
  className,
}: {
  children?: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={clsx(
        'th border-b border-[var(--color-line)] px-4 py-2.5 whitespace-nowrap',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = 'left',
  mono = false,
  className,
  colSpan,
}: {
  children?: ReactNode;
  align?: 'left' | 'right' | 'center';
  mono?: boolean;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={clsx(
        'border-b border-[var(--color-line)] px-4 py-3',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        mono && 'num',
        className,
      )}
    >
      {children}
    </td>
  );
}

/* -------------------------------------------------------------------------- */
/*  Estados vazios e de carregamento                                          */
/* -------------------------------------------------------------------------- */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 text-[var(--color-faint)]">{icon}</div>}
      <p className="text-sm font-medium text-[var(--color-text)]">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-xs text-[var(--color-muted)]">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={clsx('animate-pulse rounded-md bg-[var(--color-line)]/60', className)}
      aria-hidden="true"
    />
  );
}

/** Esqueleto com a mesma geometria da grade de KPIs, para nao pular no load. */
export function StatGridSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card p-4">
          <Skeleton className="mb-3 h-3 w-24" />
          <Skeleton className="h-7 w-32" />
          <Skeleton className="mt-3 h-3 w-36" />
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Botoes                                                                    */
/* -------------------------------------------------------------------------- */

export function Button({
  children,
  onClick,
  variant = 'secondary',
  size = 'md',
  type = 'button',
  disabled,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  type?: 'button' | 'submit';
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-[13px]',
        variant === 'primary' && 'bg-[var(--color-ink)] text-white hover:bg-[#2a2a30]',
        variant === 'secondary' &&
          'border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-text)] hover:border-[var(--color-line-strong)]',
        variant === 'ghost' && 'text-[var(--color-muted)] hover:text-[var(--color-text)]',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Ponto colorido que carrega a identidade de uma categoria ao lado do nome. */
export function Dot({ color }: { color: string }) {
  return (
    <span
      className="inline-block size-2 shrink-0 rounded-full"
      style={{ background: color }}
      aria-hidden="true"
    />
  );
}
