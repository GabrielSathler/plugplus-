import {
  addMonths,
  clampDayToMonth,
  parseISODate,
  parseYearMonth,
  toYearMonth,
  type ISODate,
  type YearMonth,
} from '../date.ts';

/**
 * Ciclo de fatura de cartao de credito.
 *
 * ADR — "competencia da fatura" e o mes do VENCIMENTO, nao o do fechamento.
 * Um cartao que fecha 28/07 e vence 05/08 gera a "fatura de agosto". Foi a
 * escolha certa porque o app projeta CAIXA: o mes em que o dinheiro sai da
 * conta corrente e o mes do vencimento, e e assim que o usuario fala ("a fatura
 * de agosto veio alta"). Keying pelo fechamento desalinharia a projecao de
 * saldo em um mes inteiro.
 */

export interface CardCycleConfig {
  closingDay: number;
  dueDay: number;
  /** Ver `CreditCard.closingDayInclusive`. */
  closingDayInclusive?: boolean;
}

export interface CardCycle {
  /** Mes do vencimento (`YYYY-MM`) — identidade da fatura. */
  referenceMonth: YearMonth;
  /** Primeiro dia de compras que cai nesta fatura. */
  periodStart: ISODate;
  /** Ultimo dia de compras que cai nesta fatura. */
  periodEnd: ISODate;
  closingDate: ISODate;
  dueDate: ISODate;
}

function assertValidConfig(config: CardCycleConfig): void {
  const { closingDay, dueDay } = config;
  if (!Number.isInteger(closingDay) || closingDay < 1 || closingDay > 31) {
    throw new RangeError(`Dia de fechamento invalido: ${closingDay}`);
  }
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    throw new RangeError(`Dia de vencimento invalido: ${dueDay}`);
  }
}

/**
 * Vencimento de um ciclo que fecha em `closingDate`.
 *
 * Regra: `dueDay > closingDay` significa que o vencimento cabe no mesmo mes do
 * fechamento (fecha dia 3, vence dia 10). Caso contrario o vencimento e no mes
 * seguinte (fecha dia 28, vence dia 05). O caso de igualdade cai no mes
 * seguinte — nenhum emissor fecha e cobra no mesmo dia.
 */
function dueDateForClosing(closingDate: ISODate, config: CardCycleConfig): ISODate {
  const { year, month } = parseISODate(closingDate);
  if (config.dueDay > config.closingDay) {
    return clampDayToMonth(year, month, config.dueDay);
  }
  const nextMonth = addMonths(clampDayToMonth(year, month, 1), 1);
  const next = parseISODate(nextMonth);
  return clampDayToMonth(next.year, next.month, config.dueDay);
}

/** Data de fechamento imediatamente anterior (exclusiva) a `closingDate`. */
function previousClosing(closingDate: ISODate, config: CardCycleConfig): ISODate {
  const previousMonthAnchor = addMonths(closingDate, -1);
  const { year, month } = parseISODate(previousMonthAnchor);
  return clampDayToMonth(year, month, config.closingDay);
}

/**
 * Em que fatura cai uma compra feita em `purchaseDate`.
 *
 * Este e o coracao do produto: erra aqui e toda a projecao de caixa desanda em
 * um mes. A compra pertence ao ciclo que fecha na PROXIMA data de fechamento
 * estritamente posterior a ela (ou igual, se `closingDayInclusive`).
 */
export function resolveCycleForPurchase(
  purchaseDate: ISODate,
  config: CardCycleConfig,
): CardCycle {
  assertValidConfig(config);
  const { year, month, day } = parseISODate(purchaseDate);

  const closingThisMonth = clampDayToMonth(year, month, config.closingDay);
  const closingDayThisMonth = parseISODate(closingThisMonth).day;

  const fitsInThisCycle = config.closingDayInclusive
    ? day <= closingDayThisMonth
    : day < closingDayThisMonth;

  const closingDate = fitsInThisCycle ? closingThisMonth : nextClosing(closingThisMonth, config);
  return buildCycle(closingDate, config);
}

function nextClosing(closingDate: ISODate, config: CardCycleConfig): ISODate {
  const nextAnchor = addMonths(closingDate, 1);
  const { year, month } = parseISODate(nextAnchor);
  return clampDayToMonth(year, month, config.closingDay);
}

function buildCycle(closingDate: ISODate, config: CardCycleConfig): CardCycle {
  const dueDate = dueDateForClosing(closingDate, config);
  const prevClosing = previousClosing(closingDate, config);
  // Ciclos consecutivos precisam cobrir o calendario sem buraco nem
  // sobreposicao: `periodEnd` de um e sempre a vespera do `periodStart` do
  // seguinte. Com fechamento EXCLUSIVO a compra do proprio dia 28 rola para a
  // fatura seguinte, entao o dia 28 abre o proximo periodo. Com fechamento
  // INCLUSIVO o dia 28 fecha o periodo atual, e o proximo comeca no dia 29.
  const periodStart = config.closingDayInclusive ? addDaysISO(prevClosing, 1) : prevClosing;
  const periodEnd = config.closingDayInclusive ? closingDate : addDaysISO(closingDate, -1);

  return {
    referenceMonth: toYearMonth(dueDate),
    periodStart,
    periodEnd,
    closingDate,
    dueDate,
  };
}

function addDaysISO(date: ISODate, delta: number): ISODate {
  const { year, month, day } = parseISODate(date);
  const utc = new Date(Date.UTC(year, month - 1, day + delta));
  const y = utc.getUTCFullYear();
  const m = utc.getUTCMonth() + 1;
  const d = utc.getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Ciclo cuja fatura vence em `referenceMonth`. Inverso de `resolveCycleForPurchase`. */
export function cycleForReferenceMonth(
  referenceMonth: YearMonth,
  config: CardCycleConfig,
): CardCycle {
  assertValidConfig(config);
  const { year, month } = parseYearMonth(referenceMonth);
  // O fechamento e no mes do vencimento quando `dueDay > closingDay`, senao no
  // mes anterior. E exatamente o inverso de `dueDateForClosing`.
  const closingMonthOffset = config.dueDay > config.closingDay ? 0 : -1;
  const anchor = addMonths(clampDayToMonth(year, month, 1), closingMonthOffset);
  const anchorParts = parseISODate(anchor);
  const closingDate = clampDayToMonth(anchorParts.year, anchorParts.month, config.closingDay);
  return buildCycle(closingDate, config);
}

/**
 * Progresso do ciclo em aberto, 0-100. Alimenta o badge "68% do ciclo" e a
 * barra do cartao ("19 de 28 dias do ciclo").
 */
export function cycleProgress(
  cycle: CardCycle,
  today: ISODate,
): { elapsedDays: number; totalDays: number; percent: number } {
  const totalDays = daysBetween(cycle.periodStart, cycle.periodEnd) + 1;
  const rawElapsed = daysBetween(cycle.periodStart, today) + 1;
  const elapsedDays = Math.min(Math.max(rawElapsed, 0), totalDays);
  return {
    elapsedDays,
    totalDays,
    percent: totalDays === 0 ? 0 : (elapsedDays / totalDays) * 100,
  };
}

export function daysBetween(from: ISODate, to: ISODate): number {
  const a = parseISODate(from);
  const b = parseISODate(to);
  const msA = Date.UTC(a.year, a.month - 1, a.day);
  const msB = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((msB - msA) / 86_400_000);
}

/** Status derivado da fatura a partir das datas e do pagamento registrado. */
export function deriveInvoiceStatus(
  cycle: CardCycle,
  today: ISODate,
  paidAmount: number,
  total: number,
): 'OPEN' | 'CLOSED' | 'PAID' | 'OVERDUE' | 'PROJECTED' {
  if (paidAmount > 0 && paidAmount >= total) return 'PAID';
  if (today <= cycle.periodEnd) {
    // Ciclo corrente e ciclos futuros compartilham a mesma matematica; o que os
    // separa e so o inicio do periodo ja ter chegado.
    return today >= cycle.periodStart ? 'OPEN' : 'PROJECTED';
  }
  if (today > cycle.dueDate) return 'OVERDUE';
  return 'CLOSED';
}
