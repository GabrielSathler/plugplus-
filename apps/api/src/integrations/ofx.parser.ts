import type { ISODate } from '@finflow/shared';

/**
 * Leitor de OFX 1.x (SGML) e 2.x (XML).
 *
 * ADR — POR QUE UM PARSER PROPRIO. O OFX que os bancos brasileiros exportam e
 * SGML: tags sem fechamento, cabecalho `KEY:VALUE` antes do corpo e datas com
 * fuso colado (`20260715120000[-3:BRT]`). As bibliotecas npm de OFX ou assumem
 * XML bem formado, ou arrastam um parser SGML inteiro para ler seis tags. Sao
 * ~120 linhas de codigo previsivel contra uma dependencia que quebra no proximo
 * banco que exportar de um jeito levemente diferente.
 *
 * O import por arquivo continua importando mesmo na era do Open Finance: cobre
 * instituicao sem agregador, conta PJ e o usuario que so quer testar o produto
 * sem entregar credencial bancaria.
 */

export interface OfxTransaction {
  /** `FITID` — identificador do banco. Usado para deduplicar reimportacoes. */
  externalId: string;
  date: ISODate;
  /** CENTAVOS, sempre positivo. */
  amount: number;
  type: 'INCOME' | 'EXPENSE';
  description: string;
  memo: string | null;
  checkNumber: string | null;
}

export interface OfxStatement {
  bankId: string | null;
  accountId: string | null;
  accountType: string | null;
  currency: string;
  balance: number | null;
  balanceDate: ISODate | null;
  transactions: OfxTransaction[];
}

export function parseOfx(raw: string): OfxStatement {
  const body = stripHeader(raw);

  const transactions: OfxTransaction[] = [];
  for (const block of extractBlocks(body, 'STMTTRN')) {
    const amountRaw = tagValue(block, 'TRNAMT');
    const dateRaw = tagValue(block, 'DTPOSTED');
    if (!amountRaw || !dateRaw) continue;

    const amount = parseAmount(amountRaw);
    transactions.push({
      externalId: tagValue(block, 'FITID') ?? `${dateRaw}-${amountRaw}`,
      date: parseOfxDate(dateRaw),
      amount: Math.abs(amount),
      type: amount >= 0 ? 'INCOME' : 'EXPENSE',
      description: (tagValue(block, 'NAME') ?? tagValue(block, 'MEMO') ?? 'Lancamento').trim(),
      memo: tagValue(block, 'MEMO')?.trim() ?? null,
      checkNumber: tagValue(block, 'CHECKNUM') ?? null,
    });
  }

  const balanceRaw = tagValue(body, 'BALAMT');
  const balanceDateRaw = tagValue(body, 'DTASOF');

  return {
    bankId: tagValue(body, 'BANKID'),
    accountId: tagValue(body, 'ACCTID'),
    accountType: tagValue(body, 'ACCTTYPE'),
    currency: tagValue(body, 'CURDEF') ?? 'BRL',
    balance: balanceRaw ? parseAmount(balanceRaw) : null,
    balanceDate: balanceDateRaw ? parseOfxDate(balanceDateRaw) : null,
    transactions,
  };
}

/** Remove o cabecalho `OFXHEADER:100 / DATA:OFXSGML / ...` anterior a `<OFX>`. */
function stripHeader(raw: string): string {
  const start = raw.indexOf('<OFX>');
  return start === -1 ? raw : raw.slice(start);
}

/** Todos os blocos `<TAG> ... </TAG>`, tolerando o fechamento ausente do SGML. */
function extractBlocks(source: string, tag: string): string[] {
  const blocks: string[] = [];
  const open = `<${tag}>`;
  const close = `</${tag}>`;

  let index = source.indexOf(open);
  while (index !== -1) {
    const from = index + open.length;
    const closeIndex = source.indexOf(close, from);
    const nextOpen = source.indexOf(open, from);

    // Sem fechamento, o bloco vai ate a proxima abertura da mesma tag.
    const end =
      closeIndex !== -1 && (nextOpen === -1 || closeIndex < nextOpen)
        ? closeIndex
        : nextOpen !== -1
          ? nextOpen
          : source.length;

    blocks.push(source.slice(from, end));
    index = source.indexOf(open, end);
  }
  return blocks;
}

/** Valor de uma tag simples; para no fim da linha ou na proxima tag. */
function tagValue(source: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(source);
  return match ? match[1].trim() || null : null;
}

/**
 * `20260715120000[-3:BRT]` -> `2026-07-15`.
 *
 * O horario e o fuso sao descartados de proposito: o dominio trabalha com o DIA
 * calendario, e converter para UTC empurraria uma compra da meia-noite para o
 * dia anterior.
 */
function parseOfxDate(raw: string): ISODate {
  const digits = raw.replace(/[^\d]/g, '').slice(0, 8);
  if (digits.length < 8) throw new RangeError(`Data OFX invalida: "${raw}"`);
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

/** `-1.234,56` ou `-1234.56` -> centavos inteiros. */
function parseAmount(raw: string): number {
  let normalized = raw.trim();
  const hasComma = normalized.includes(',');
  const hasDot = normalized.includes('.');

  if (hasComma && hasDot) {
    // Formato pt-BR: ponto e separador de milhar, virgula e decimal.
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    normalized = normalized.replace(',', '.');
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) throw new RangeError(`Valor OFX invalido: "${raw}"`);
  return Math.round(value * 100);
}

/* -------------------------------------------------------------------------- */
/*  CSV                                                                       */
/* -------------------------------------------------------------------------- */

export interface CsvTransaction {
  date: ISODate;
  description: string;
  amount: number;
  type: 'INCOME' | 'EXPENSE';
}

/**
 * CSV com cabecalho, aceitando `,` ou `;` como separador (Excel pt-BR usa `;`).
 * Colunas reconhecidas: data/date, descricao/description/historico, valor/amount.
 */
export function parseCsv(raw: string): CsvTransaction[] {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const separator = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const header = lines[0].split(separator).map((h) => normalizeHeader(h));

  const dateIndex = header.findIndex((h) => ['data', 'date'].includes(h));
  const descriptionIndex = header.findIndex((h) =>
    ['descricao', 'description', 'historico', 'lancamento'].includes(h),
  );
  const amountIndex = header.findIndex((h) => ['valor', 'amount', 'value'].includes(h));

  if (dateIndex === -1 || amountIndex === -1) {
    throw new RangeError('CSV precisa de ao menos as colunas de data e valor.');
  }

  const rows: CsvTransaction[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(separator);
    const amount = parseAmount(cells[amountIndex] ?? '0');
    rows.push({
      date: normalizeDate(cells[dateIndex] ?? ''),
      description: (cells[descriptionIndex] ?? 'Lancamento').trim().replace(/^"|"$/g, ''),
      amount: Math.abs(amount),
      type: amount >= 0 ? 'INCOME' : 'EXPENSE',
    });
  }
  return rows;
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^"|"$/g, '');
}

/** Aceita `15/07/2026` e `2026-07-15`. */
function normalizeDate(value: string): ISODate {
  const trimmed = value.trim().replace(/^"|"$/g, '');
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  throw new RangeError(`Data invalida no CSV: "${value}"`);
}
