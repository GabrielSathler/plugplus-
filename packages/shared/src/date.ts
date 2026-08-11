/**
 * Utilitarios de data livres de fuso horario.
 *
 * DECISAO DE ARQUITETURA: datas de negocio (compra, fechamento, vencimento,
 * competencia) sao representadas como strings `YYYY-MM-DD` e nunca como `Date`.
 * Motivo: `Date` carrega horario + fuso e produz o classico bug de "a compra do
 * dia 01 virou dia 31 do mes anterior" quando o servidor roda em UTC e o usuario
 * em America/Sao_Paulo. Toda a matematica de ciclo de fatura depende do DIA
 * calendario, entao trabalhamos com o dia calendario direto.
 *
 * `Date` continua sendo usado apenas para timestamps tecnicos (createdAt etc).
 */

/** Data civil no formato `YYYY-MM-DD`. */
export type ISODate = string;
/** Competencia mensal no formato `YYYY-MM`. */
export type YearMonth = string;

export interface DateParts {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_MONTH_RE = /^(\d{4})-(\d{2})$/;

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

export function isISODate(value: unknown): value is ISODate {
  return typeof value === 'string' && ISO_DATE_RE.test(value);
}

export function isYearMonth(value: unknown): value is YearMonth {
  return typeof value === 'string' && YEAR_MONTH_RE.test(value);
}

export function parseISODate(date: ISODate): DateParts {
  const match = ISO_DATE_RE.exec(date);
  if (!match) throw new RangeError(`Data invalida (esperado YYYY-MM-DD): "${date}"`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function parseYearMonth(ym: YearMonth): { year: number; month: number } {
  const match = YEAR_MONTH_RE.exec(ym);
  if (!match) throw new RangeError(`Competencia invalida (esperado YYYY-MM): "${ym}"`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function toISODate(parts: DateParts): ISODate {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

export function toYearMonth(input: ISODate | { year: number; month: number }): YearMonth {
  if (typeof input === 'string') {
    const { year, month } = parseISODate(input);
    return `${year}-${pad2(month)}`;
  }
  return `${input.year}-${pad2(input.month)}`;
}

/** Quantidade de dias do mes (1-12), considerando ano bissexto. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Ancora um "dia do mes" configurado (ex.: fechamento no dia 31) dentro de um mes
 * real. Fevereiro vira dia 28/29, abril vira 30. Regra usada por todas as
 * bandeiras: quando o dia nao existe, cai no ultimo dia do mes.
 */
export function clampDayToMonth(year: number, month: number, day: number): ISODate {
  const max = daysInMonth(year, month);
  return toISODate({ year, month, day: Math.min(Math.max(day, 1), max) });
}

export function addMonthsToYearMonth(ym: YearMonth, delta: number): YearMonth {
  const { year, month } = parseYearMonth(ym);
  const zeroBased = year * 12 + (month - 1) + delta;
  return toYearMonth({ year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 });
}

/** Soma meses preservando o dia quando possivel, com clamp no fim do mes. */
export function addMonths(date: ISODate, delta: number): ISODate {
  const { year, month, day } = parseISODate(date);
  const zeroBased = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(zeroBased / 12);
  const nextMonth = (zeroBased % 12) + 1;
  return clampDayToMonth(nextYear, nextMonth, day);
}

export function addDays(date: ISODate, delta: number): ISODate {
  const { year, month, day } = parseISODate(date);
  const utc = new Date(Date.UTC(year, month - 1, day + delta));
  return toISODate({
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  });
}

/** Diferenca em meses inteiros entre duas competencias (b - a). */
export function diffMonths(a: YearMonth, b: YearMonth): number {
  const pa = parseYearMonth(a);
  const pb = parseYearMonth(b);
  return (pb.year - pa.year) * 12 + (pb.month - pa.month);
}

export function compareISODate(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isBetween(date: ISODate, start: ISODate, end: ISODate): boolean {
  return date >= start && date <= end;
}

export function startOfMonth(ym: YearMonth): ISODate {
  const { year, month } = parseYearMonth(ym);
  return toISODate({ year, month, day: 1 });
}

export function endOfMonth(ym: YearMonth): ISODate {
  const { year, month } = parseYearMonth(ym);
  return toISODate({ year, month, day: daysInMonth(year, month) });
}

/** Sequencia de competencias `[from, from+1, ... ]` com `count` itens. */
export function monthRange(from: YearMonth, count: number): YearMonth[] {
  return Array.from({ length: Math.max(count, 0) }, (_, i) => addMonthsToYearMonth(from, i));
}

/** Dia da semana (0 = domingo) sem influencia de fuso. */
export function weekdayOf(date: ISODate): number {
  const { year, month, day } = parseISODate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Data de hoje no fuso informado (default America/Sao_Paulo). */
export function today(timeZone = 'America/Sao_Paulo', now: Date = new Date()): ISODate {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now);
}

const MONTH_LABELS_PT = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez',
];

/** `2026-03` -> `mar/26`. Rotulo curto para eixos de grafico. */
export function formatYearMonthShort(ym: YearMonth): string {
  const { year, month } = parseYearMonth(ym);
  return `${MONTH_LABELS_PT[month - 1]}/${String(year).slice(2)}`;
}

/** `2026-03-15` -> `15/03/2026`. */
export function formatISODateBR(date: ISODate): string {
  const { year, month, day } = parseISODate(date);
  return `${pad2(day)}/${pad2(month)}/${year}`;
}
