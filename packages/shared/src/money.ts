/**
 * Dinheiro em centavos (inteiro).
 *
 * DECISAO DE ARQUITETURA: nenhum valor monetario trafega como float. `0.1 + 0.2`
 * em IEEE-754 nao e `0.3`, e um SaaS financeiro que erra centavo perde a
 * confianca do usuario na primeira conciliacao. Todo valor e `number` inteiro em
 * centavos, do banco ate o componente React; a conversao para decimal acontece
 * somente na formatacao.
 */

/** Valor monetario inteiro em centavos. */
export type Cents = number;

export function toCents(value: number): Cents {
  return Math.round(value * 100);
}

export function fromCents(value: Cents): number {
  return value / 100;
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/** Percentual (0-100) de `part` sobre `total`, protegido contra divisao por zero. */
export function percentOf(part: Cents, total: Cents): number {
  if (total === 0) return 0;
  return (part / total) * 100;
}

/** Variacao percentual entre dois periodos. `null` quando nao ha base de comparacao. */
export function variationPercent(current: Cents, previous: Cents): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export type RemainderPolicy = 'first' | 'last';

/**
 * Divide um valor em N parcelas inteiras sem perder centavos.
 *
 * R$ 100,00 em 3x nao e 3 x R$ 33,33 (some: R$ 99,99 — some um centavo).
 * A convencao usada pelos emissores brasileiros joga a sobra na PRIMEIRA
 * parcela: R$ 33,34 + R$ 33,33 + R$ 33,33. `policy: 'last'` inverte isso para
 * emissores que cobram a sobra no final.
 */
export function splitInstallments(
  total: Cents,
  count: number,
  policy: RemainderPolicy = 'first',
): Cents[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`Numero de parcelas invalido: ${count}`);
  }
  const sign = total < 0 ? -1 : 1;
  const absolute = Math.abs(total);
  const base = Math.floor(absolute / count);
  const remainder = absolute - base * count;

  const parts = Array.from({ length: count }, () => base * sign);
  const targetIndex = policy === 'first' ? 0 : count - 1;
  parts[targetIndex] += remainder * sign;
  return parts;
}

const BRL_FORMATTER = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const BRL_COMPACT_FORMATTER = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function formatCurrency(value: Cents, currency = 'BRL'): string {
  if (currency === 'BRL') return BRL_FORMATTER.format(fromCents(value));
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(fromCents(value));
}

/** `R$ 12,3 mil` — para eixos de grafico e tiles onde espaco e escasso. */
export function formatCurrencyCompact(value: Cents, currency = 'BRL'): string {
  if (currency === 'BRL') return BRL_COMPACT_FORMATTER.format(fromCents(value));
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
    notation: 'compact',
  }).format(fromCents(value));
}

export function formatPercent(value: number, fractionDigits = 1): string {
  return `${value.toFixed(fractionDigits).replace('.', ',')}%`;
}
