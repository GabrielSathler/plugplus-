import {
  addDays,
  addMonthsToYearMonth,
  clampDayToMonth,
  endOfMonth,
  parseISODate,
  parseYearMonth,
  startOfMonth,
  weekdayOf,
  type ISODate,
  type YearMonth,
} from '../date.ts';
import type { Frequency, RecurringRule } from '../types.ts';

/** Passo em meses de cada frequencia. `WEEKLY` e tratado a parte. */
const MONTH_STEP: Record<Exclude<Frequency, 'WEEKLY'>, number> = {
  MONTHLY: 1,
  BIMONTHLY: 2,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  YEARLY: 12,
};

/**
 * Datas em que uma regra recorrente dispara dentro de uma competencia.
 *
 * Retorna array porque regras semanais disparam 4-5 vezes no mes. Regras
 * mensais ou maiores retornam 0 ou 1 data — 0 quando a competencia nao cai no
 * passo da regra (ex.: trimestral em um mes intermediario).
 */
export function occurrencesInMonth(rule: RecurringRule, month: YearMonth): ISODate[] {
  if (!rule.isActive) return [];

  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  if (monthEnd < rule.startDate) return [];
  if (rule.endDate && monthStart > rule.endDate) return [];

  if (rule.frequency === 'WEEKLY') {
    return weeklyOccurrences(rule, monthStart, monthEnd);
  }

  const step = MONTH_STEP[rule.frequency];
  const startMonth = ruleStartMonth(rule);
  const monthsSinceStart = monthsBetween(startMonth, month);
  if (monthsSinceStart < 0 || monthsSinceStart % step !== 0) return [];

  const { year, month: monthNumber } = parseYearMonth(month);
  const day = rule.dayOfMonth ?? parseISODate(rule.startDate).day;
  const date = clampDayToMonth(year, monthNumber, day);

  if (date < rule.startDate) return [];
  if (rule.endDate && date > rule.endDate) return [];
  return [date];
}

function weeklyOccurrences(rule: RecurringRule, monthStart: ISODate, monthEnd: ISODate): ISODate[] {
  const targetWeekday = rule.weekday ?? weekdayOf(rule.startDate);
  const dates: ISODate[] = [];
  let cursor = monthStart > rule.startDate ? monthStart : rule.startDate;

  while (weekdayOf(cursor) !== targetWeekday) cursor = addDays(cursor, 1);
  while (cursor <= monthEnd) {
    if (!rule.endDate || cursor <= rule.endDate) dates.push(cursor);
    cursor = addDays(cursor, 7);
  }
  return dates;
}

function ruleStartMonth(rule: RecurringRule): YearMonth {
  const { year, month } = parseISODate(rule.startDate);
  return `${year}-${String(month).padStart(2, '0')}`;
}

function monthsBetween(from: YearMonth, to: YearMonth): number {
  const a = parseYearMonth(from);
  const b = parseYearMonth(to);
  return (b.year - a.year) * 12 + (b.month - a.month);
}

/** Proxima ocorrencia a partir de `from` (inclusive), varrendo ate 24 meses. */
export function nextOccurrence(rule: RecurringRule, from: ISODate): ISODate | null {
  const { year, month } = parseISODate(from);
  let cursor: YearMonth = `${year}-${String(month).padStart(2, '0')}`;
  for (let i = 0; i < 24; i += 1) {
    const hit = occurrencesInMonth(rule, cursor).find((date) => date >= from);
    if (hit) return hit;
    cursor = addMonthsToYearMonth(cursor, 1);
  }
  return null;
}
