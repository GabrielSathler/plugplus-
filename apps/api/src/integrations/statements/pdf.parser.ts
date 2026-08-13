import { extractText, getDocumentProxy } from 'unpdf';

/**
 * Leitura de extrato em PDF.
 *
 * ADR — POR QUE ISTO NUNCA IMPORTA DIRETO, AO CONTRARIO DO OFX.
 *
 * PDF nao tem modelo de dados. O arquivo guarda glifos com coordenadas, nao
 * linhas nem colunas nem "transacoes" — a tabela que voce enxerga na tela e
 * uma ilusao criada pelo posicionamento. Extrair dado dali e RECONSTRUIR uma
 * estrutura que nunca existiu, a partir de pistas visuais.
 *
 * Tres consequencias praticas:
 *
 *   1. Nao ha identificador. OFX traz `FITID` do proprio banco, o que resolve
 *      deduplicacao de graca. Aqui a chave precisa ser sintetizada do
 *      conteudo, e dois lancamentos iguais no mesmo dia sao indistinguiveis.
 *
 *   2. O layout muda sem aviso. O banco troca a fatura de lugar e o parser que
 *      funcionava passa a devolver numero errado — sem erro, sem exceção.
 *
 *   3. Um numero lido errado vira dinheiro errado no relatorio.
 *
 * Por isso este modulo devolve um RASCUNHO com nivel de confianca, e quem
 * decide o que entra e a pessoa, na tela de revisao. Importar PDF em um clique
 * seria a decisao errada num produto financeiro.
 */

export interface ParsedLine {
  /** Linha reconstruida, para a pessoa conferir contra o PDF original. */
  raw: string;
  date: string | null;
  description: string;
  /** CENTAVOS, sempre positivo. O sinal vai em `type`. */
  amount: number | null;
  type: 'INCOME' | 'EXPENSE';
  /** 0-1. Abaixo de 0.6 a linha entra desmarcada na revisao. */
  confidence: number;
  page: number;
}

export interface ParsedPdf {
  lines: ParsedLine[];
  /** Texto cru por pagina — a rede de seguranca quando o parser erra. */
  pages: string[][];
  detectedBank: string | null;
  warnings: string[];
}

/** Item de texto com posicao, como o pdfjs entrega. */
interface TextItem {
  str: string;
  x: number;
  y: number;
}

/**
 * Reconstroi as linhas visuais do PDF.
 *
 * O pdfjs devolve fragmentos soltos — "15/07", "2026", "PIX ENVIADO" podem vir
 * separados. Agrupamos por coordenada Y (mesma altura = mesma linha) e
 * ordenamos por X, que e o que o olho faz ao ler.
 *
 * A tolerancia de 2 unidades absorve o desalinhamento sub-pixel que fontes
 * diferentes na mesma linha produzem; sem ela, um valor em negrito viraria
 * uma linha propria.
 */
function groupIntoLines(items: TextItem[]): string[] {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: string[] = [];
  let current: TextItem[] = [sorted[0]];

  for (const item of sorted.slice(1)) {
    if (Math.abs(item.y - current[0].y) <= 2) {
      current.push(item);
    } else {
      lines.push(joinLine(current));
      current = [item];
    }
  }
  lines.push(joinLine(current));

  return lines.map((line) => line.trim()).filter(Boolean);
}

function joinLine(items: TextItem[]): string {
  return items
    .sort((a, b) => a.x - b.x)
    .map((item) => item.str)
    .join(' ')
    .replace(/\s+/g, ' ');
}

export async function extractLines(buffer: Uint8Array): Promise<{ pages: string[][] }> {
  const pdf = await getDocumentProxy(buffer);
  const pages: string[][] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();

    // `content.items` mistura texto com marcadores de estrutura; só o primeiro
    // tipo tem `str` e `transform`.
    const items: TextItem[] = content.items
      .flatMap((item) => {
        const candidate = item as { str?: unknown; transform?: unknown };
        if (typeof candidate.str !== 'string' || !Array.isArray(candidate.transform)) return [];
        const transform = candidate.transform as number[];
        // A matriz de transformacao carrega a posicao nos indices 4 e 5.
        return [{ str: candidate.str, x: transform[4], y: transform[5] }];
      })
      .filter((item) => item.str.trim().length > 0);

    pages.push(groupIntoLines(items));
  }

  return { pages };
}

/** Fallback quando a extracao com posicao falha (PDF exotico). */
export async function extractPlainText(buffer: Uint8Array): Promise<string[]> {
  const { text } = await extractText(buffer, { mergePages: false });
  return Array.isArray(text) ? text : [text];
}

/* -------------------------------------------------------------------------- */
/*  Interpretacao das linhas                                                  */
/* -------------------------------------------------------------------------- */

/** `1.234,56` / `-1.234,56` / `R$ 1.234,56` / `1234.56` -> centavos. */
export function parseBrlAmount(raw: string): number | null {
  const cleaned = raw.replace(/R\$/gi, '').replace(/\s/g, '').trim();
  if (!/^[-+]?[\d.,]+$/.test(cleaned)) return null;

  const negative = cleaned.startsWith('-');
  let digits = cleaned.replace(/^[-+]/, '');

  const lastComma = digits.lastIndexOf(',');
  const lastDot = digits.lastIndexOf('.');

  // O separador DECIMAL e o ultimo que aparece. `1.234,56` e `1,234.56` sao
  // ambos validos no mundo real e so essa regra distingue os dois.
  if (lastComma > lastDot) {
    digits = digits.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    digits = digits.replace(/,/g, '');
  } else {
    digits = digits.replace(/[.,]/g, '');
  }

  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) * (negative ? -1 : 1);
}

/** `15/07/2026`, `15/07/26` ou `15/07` (usa o ano de referencia). */
export function parseBrDate(raw: string, fallbackYear: number): string | null {
  const match = /(\d{2})\/(\d{2})(?:\/(\d{2,4}))?/.exec(raw);
  if (!match) return null;

  const [, day, month, yearRaw] = match;
  let year = fallbackYear;
  if (yearRaw) year = yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw);

  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) return null;

  return `${year}-${month}-${day}`;
}

/**
 * Linhas que nunca sao lancamento.
 *
 * "Saldo" e a mais importante: ela tem data e valor, passa em qualquer regex
 * ingenua, e importada vira uma despesa fantasma do tamanho do seu saldo.
 */
const NOISE = [
  /^saldo/i,
  /saldo\s+(anterior|do\s+dia|final|em\s+conta|disponivel|dispon[ií]vel)/i,
  /^extrato/i,
  /^p[áa]gina\s+\d/i,
  /^total\b/i,
  /^per[íi]odo/i,
  /^ag[êe]ncia/i,
  /^conta\s*:/i,
  /^data\s+(hist[óo]rico|descri)/i,
  /^lan[çc]amentos?$/i,
  /banco\s+inter\s+s\.?a/i,
  /^cnpj/i,
  /ouvidoria/i,
  /^\s*$/,
];

function isNoise(line: string): boolean {
  return NOISE.some((pattern) => pattern.test(line.trim()));
}

/**
 * Interpreta uma linha de extrato brasileiro.
 *
 * O formato dominante e `DATA  DESCRICAO  VALOR`, com o valor no fim. A
 * estrategia e ancorar nas duas pontas — data no comeco, dinheiro no fim — e
 * tratar o miolo como descricao. E o que sobrevive a mais variacoes de layout
 * do que tentar casar a linha inteira com um padrao rigido.
 */
export function interpretLine(line: string, page: number, fallbackYear: number): ParsedLine | null {
  const raw = line.trim();
  if (isNoise(raw) || raw.length < 8) return null;

  const date = parseBrDate(raw, fallbackYear);
  if (!date) return null;

  // Todos os candidatos a valor; o ultimo costuma ser o do lancamento, e os
  // anteriores, quando existem, sao saldo parcial.
  const amountMatches = [...raw.matchAll(/(-?\s?R?\$?\s?\d{1,3}(?:\.\d{3})*,\d{2}|-?\s?\d+,\d{2})/g)];
  if (amountMatches.length === 0) return null;

  const chosen = amountMatches[amountMatches.length - 1];
  const amount = parseBrlAmount(chosen[1].replace(/\s/g, ''));
  if (amount === null || amount === 0) return null;

  const description = raw
    .slice(0, chosen.index)
    .replace(/^\d{2}\/\d{2}(?:\/\d{2,4})?/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (description.length < 2) return null;

  // O sinal explicito e a evidencia mais forte. Sem ele, palavras que indicam
  // entrada resolvem; na duvida, despesa — que e a maioria e o erro menos
  // perigoso (inflar receita esconde aperto, inflar despesa apenas assusta).
  const explicitNegative = /-/.test(chosen[1]);
  const incomeWord =
    /(recebid|credito|cr[ée]dito|dep[óo]sito|estorno|rendimento|salario|sal[áa]rio|transferencia recebida|pix recebido)/i.test(
      description,
    );

  const type: 'INCOME' | 'EXPENSE' = explicitNegative ? 'EXPENSE' : incomeWord ? 'INCOME' : 'EXPENSE';

  let confidence = 0.75;
  if (amountMatches.length > 1) confidence -= 0.15; // pode ter pego o saldo
  if (explicitNegative || incomeWord) confidence += 0.15;
  if (description.length > 6) confidence += 0.05;

  return {
    raw,
    date,
    description,
    amount: Math.abs(amount),
    type,
    confidence: Math.min(Math.max(confidence, 0), 1),
    page,
  };
}
