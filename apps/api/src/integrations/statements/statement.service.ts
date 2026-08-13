import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { parseCsv, parseOfx } from '../ofx.parser';
import { extractLines, interpretLine, type ParsedLine } from './pdf.parser';

export type StatementFormat = 'OFX' | 'CSV' | 'PDF';

export interface DraftEntry {
  /** Chave estavel usada para deduplicar e para o cliente devolver a selecao. */
  key: string;
  date: string;
  description: string;
  /** CENTAVOS, positivo. */
  amount: number;
  type: 'INCOME' | 'EXPENSE';
  confidence: number;
  /** Ja existe lancamento igual na base? */
  duplicate: boolean;
  raw?: string;
  page?: number;
}

export interface StatementPreview {
  format: StatementFormat;
  /** SHA-256 do arquivo. O conteudo nao e guardado; so este hash. */
  fileHash: string;
  filename: string | null;
  /** Preenchido quando o mesmo arquivo ja passou por aqui. */
  alreadyImportedAt: string | null;
  detectedBank: string | null;
  entries: DraftEntry[];
  duplicates: number;
  warnings: string[];
  /** Texto cru, so no PDF — a rede de seguranca quando o parser erra. */
  pages?: string[][];
}

@Injectable()
export class StatementService {
  private readonly logger = new Logger(StatementService.name);

  constructor(private readonly prisma: PrismaService) {}

  detectFormat(content: string, filename?: string): StatementFormat {
    const name = filename?.toLowerCase() ?? '';
    if (name.endsWith('.pdf') || content.startsWith('%PDF')) return 'PDF';
    if (content.includes('<OFX>') || name.endsWith('.ofx')) return 'OFX';
    return 'CSV';
  }

  /**
   * Le o arquivo e devolve um RASCUNHO. Nao grava nada.
   *
   * A separacao entre ler e gravar existe por causa do PDF: interpretacao de
   * layout erra, e num produto financeiro um erro silencioso e pior do que
   * uma importacao que nao acontece. Quem confirma o que entra e a pessoa.
   *
   * OFX e CSV passam pelo mesmo caminho por coerencia — a tela de revisao e a
   * mesma, e conferir antes nunca fez mal a ninguem.
   */
  async preview(input: {
    organizationId: string;
    accountId: string;
    buffer: Buffer;
    filename?: string;
  }): Promise<StatementPreview> {
    await this.prisma.account.findFirstOrThrow({
      where: { id: input.accountId, organizationId: input.organizationId },
    });

    const decoded = input.buffer;

    // Hash do arquivo INTEIRO: identifica reimportacao do mesmo documento sem
    // guardar uma linha do conteudo.
    const fileHash = createHash('sha256').update(decoded).digest('hex');
    const previousImport = await this.prisma.statementImport.findFirst({
      where: { organizationId: input.organizationId, fileHash },
      orderBy: { createdAt: 'desc' },
    });

    const asText = decoded.subarray(0, 2048).toString('utf8');
    const format = this.detectFormat(asText, input.filename);

    const { entries, warnings, detectedBank, pages } =
      format === 'PDF'
        ? await this.readPdf(decoded)
        : format === 'OFX'
          ? this.readOfx(decoded.toString('utf8'))
          : this.readCsv(decoded.toString('utf8'));

    const withKeys = entries.map((entry) => ({
      ...entry,
      key: syntheticKey(input.accountId, entry.date, entry.amount, entry.description),
    }));

    const duplicates = await this.findDuplicates(input.organizationId, withKeys);

    if (previousImport) {
      const when = previousImport.createdAt.toLocaleDateString('pt-BR');
      warnings.unshift(
        `Este arquivo ja foi importado em ${when} — ${previousImport.linesImported} ` +
          'lancamentos entraram naquela vez. Os repetidos ja vem desmarcados abaixo.',
      );
    }

    return {
      format,
      fileHash,
      filename: input.filename ?? null,
      alreadyImportedAt: previousImport?.createdAt?.toISOString() ?? null,
      detectedBank,
      entries: withKeys.map((entry) => ({ ...entry, duplicate: duplicates.has(entry.key) })),
      duplicates: duplicates.size,
      warnings,
      pages,
    };
  }

  private async readPdf(buffer: Buffer): Promise<{
    entries: Omit<DraftEntry, 'key' | 'duplicate'>[];
    warnings: string[];
    detectedBank: string | null;
    pages: string[][];
  }> {
    const warnings: string[] = [];
    const { pages } = await extractLines(new Uint8Array(buffer));

    const flat = pages.flat();
    if (flat.length === 0) {
      // Sem nenhum texto extraivel, quase sempre e PDF escaneado: o arquivo
      // contem uma imagem da pagina, nao caracteres. So OCR resolveria.
      warnings.push(
        'Nenhum texto encontrado. O arquivo provavelmente e uma imagem digitalizada — ' +
          'exporte o extrato em OFX ou CSV pelo aplicativo do banco.',
      );
      return { entries: [], warnings, detectedBank: null, pages };
    }

    const detectedBank = detectBank(flat);
    const fallbackYear = guessYear(flat);

    const entries: Omit<DraftEntry, 'key' | 'duplicate'>[] = [];
    pages.forEach((lines, index) => {
      for (const line of lines) {
        const parsed = interpretLine(line, index + 1, fallbackYear);
        if (parsed?.amount && parsed.date) {
          entries.push({
            date: parsed.date,
            description: parsed.description,
            amount: parsed.amount,
            type: parsed.type,
            confidence: parsed.confidence,
            raw: parsed.raw,
            page: parsed.page,
          });
        }
      }
    });

    if (entries.length === 0) {
      warnings.push(
        'O texto foi lido, mas nenhuma linha tinha o formato "data · descricao · valor". ' +
          'Confira o texto extraido abaixo e, se o layout for diferente, prefira OFX.',
      );
    }

    const lowConfidence = entries.filter((entry) => entry.confidence < 0.6).length;
    if (lowConfidence > 0) {
      warnings.push(
        `${lowConfidence} ${lowConfidence === 1 ? 'linha veio' : 'linhas vieram'} com baixa confianca e ` +
          'ja estao desmarcadas. Confira o valor antes de incluir.',
      );
    }

    warnings.push(
      'PDF nao tem identificador de lancamento. A deduplicacao aqui usa data, valor e ' +
        'descricao — dois gastos identicos no mesmo dia sao indistinguiveis.',
    );

    return { entries, warnings, detectedBank, pages };
  }

  private readOfx(text: string) {
    const statement = parseOfx(text);
    return {
      entries: statement.transactions.map((tx) => ({
        date: tx.date,
        description: tx.description,
        amount: tx.amount,
        type: tx.type,
        // OFX e estruturado e vem com identificador do banco: nao ha
        // interpretacao de layout, logo nao ha incerteza.
        confidence: 1,
      })),
      warnings: [] as string[],
      detectedBank: statement.bankId,
      pages: undefined,
    };
  }

  private readCsv(text: string) {
    const { rows, rejected } = parseCsv(text);
    const warnings: string[] = [];
    if (rejected.length > 0) {
      const amostra = rejected.slice(0, 3).map((row) => `linha ${row.line}`).join(', ');
      const reticencias = rejected.length > 3 ? ', ...' : '';
      warnings.push(
        `${rejected.length} ${rejected.length === 1 ? 'linha foi ignorada' : 'linhas foram ignoradas'} ` +
          `por nao ter data ou valor validos (${amostra}${reticencias}).`,
      );
    }
    return {
      entries: rows.map((row) => ({
        date: row.date,
        description: row.description,
        amount: row.amount,
        type: row.type,
        confidence: 0.9,
      })),
      warnings,
      detectedBank: null,
      pages: undefined,
    };
  }

  /** Marca o que ja existe, comparando pela chave sintetica do conteudo. */
  private async findDuplicates(
    organizationId: string,
    entries: { key: string; date: string }[],
  ): Promise<Set<string>> {
    if (entries.length === 0) return new Set();

    const dates = entries.map((entry) => entry.date).sort();
    const existing = await this.prisma.transaction.findMany({
      where: {
        organizationId,
        date: { gte: dates[0], lte: dates[dates.length - 1] },
        externalId: { in: entries.map((entry) => entry.key) },
      },
      select: { externalId: true },
    });

    return new Set(existing.map((row) => row.externalId).filter((id): id is string => Boolean(id)));
  }

  /**
   * Grava apenas as linhas confirmadas.
   *
   * O cliente devolve os lancamentos que revisou; nada e relido do arquivo. Se
   * a pessoa corrigiu um valor na tela, e o valor corrigido que entra — o
   * parser errou uma vez e nao pode errar de novo aqui.
   */
  async commit(input: {
    organizationId: string;
    userId: string;
    accountId: string;
    format: StatementFormat;
    fileHash: string;
    filename: string;
    bank?: string;
    entries: { date: string; description: string; amount: number; type: string }[];
  }) {
    await this.prisma.account.findFirstOrThrow({
      where: { id: input.accountId, organizationId: input.organizationId },
    });

    if (input.entries.length === 0) {
      throw new BadRequestException('Nenhum lancamento selecionado.');
    }

    const dates = input.entries.map((entry) => entry.date).sort();

    // O lote nasce ANTES dos lancamentos para que cada um ja aponte para ele.
    // Sem esse vinculo, desfazer uma importacao ruim viraria caca manual.
    const batch = await this.prisma.statementImport.create({
      data: {
        organizationId: input.organizationId,
        accountId: input.accountId,
        importedById: input.userId,
        format: input.format,
        filename: input.filename.slice(0, 200),
        fileHash: input.fileHash,
        bank: input.bank ?? null,
        periodStart: dates[0] ?? null,
        periodEnd: dates[dates.length - 1] ?? null,
        linesParsed: input.entries.length,
      },
    });

    const rows = input.entries.map((entry) => ({
      importId: batch.id,
      organizationId: input.organizationId,
      description: entry.description.slice(0, 160),
      amount: Math.abs(entry.amount),
      type: entry.type === 'INCOME' ? 'INCOME' : 'EXPENSE',
      paymentMethod: 'DEBIT',
      date: entry.date,
      accountId: input.accountId,
      status: 'POSTED',
      source:
        input.format === 'OFX'
          ? 'IMPORT_OFX'
          : input.format === 'PDF'
            ? 'IMPORT_PDF'
            : 'IMPORT_CSV',
      externalId: syntheticKey(input.accountId, entry.date, entry.amount, entry.description),
    }));

    // Filtra o que ja existe antes de inserir: reimportar o mesmo extrato e o
    // caso normal, nao a excecao — o arquivo do mes seguinte sempre se
    // sobrepoe ao anterior.
    const known = await this.prisma.transaction.findMany({
      where: { organizationId: input.organizationId, externalId: { in: rows.map((r) => r.externalId) } },
      select: { externalId: true },
    });
    const seen = new Set(known.map((row) => row.externalId));
    const fresh = rows.filter((row) => {
      if (seen.has(row.externalId)) return false;
      seen.add(row.externalId);
      return true;
    });

    const result = await this.prisma.transaction.createMany({ data: fresh });

    await this.prisma.statementImport.update({
      where: { id: batch.id },
      data: { linesImported: result.count, linesSkipped: rows.length - result.count },
    });

    this.logger.log(`Importadas ${result.count} de ${rows.length} linhas (${input.format}).`);

    return {
      importId: batch.id,
      imported: result.count,
      skipped: rows.length - result.count,
      format: input.format,
    };
  }

  /** Histórico de importações — o rastro que substitui o arquivo descartado. */
  history(organizationId: string) {
    return this.prisma.statementImport.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { account: { select: { id: true, name: true } } },
    });
  }

  /**
   * Desfaz uma importação, apagando os lançamentos que ela trouxe.
   *
   * Existe porque parser de PDF erra e o erro só aparece depois, olhando o
   * relatório. Sem o vínculo com o lote, corrigir seria caçar dezenas de
   * linhas no meio do histórico — e provavelmente apagar alguma legítima junto.
   *
   * Lançamento editado à mão depois da importação continua sendo apagado: ele
   * veio do lote, e manter metade de uma importação errada é pior do que
   * refazer. O histórico do lote registra quantos saíram.
   */
  async undo(organizationId: string, importId: string) {
    const batch = await this.prisma.statementImport.findFirstOrThrow({
      where: { id: importId, organizationId },
    });

    const removed = await this.prisma.transaction.deleteMany({
      where: { organizationId, importId: batch.id },
    });

    await this.prisma.statementImport.delete({ where: { id: batch.id } });

    this.logger.log(`Importacao ${importId} desfeita: ${removed.count} lancamentos removidos.`);
    return { importId, removed: removed.count };
  }
}

/**
 * Chave de deduplicacao para origens sem identificador proprio.
 *
 * Deriva do conteudo: mesma conta, mesma data, mesmo valor e mesma descricao
 * normalizada produzem a mesma chave. Nao e perfeita — dois cafes de R$ 12 no
 * mesmo dia colidem — mas errar para MENOS e a escolha certa: lancamento
 * faltando a pessoa percebe e adiciona; lancamento duplicado ela precisa
 * caçar no meio de centenas de linhas.
 */
function syntheticKey(
  accountId: string,
  date: string,
  amount: number,
  description: string,
): string {
  const normalized = description
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 40);

  const digest = createHash('sha256')
    .update(`${accountId}|${date}|${Math.abs(amount)}|${normalized}`)
    .digest('hex')
    .slice(0, 24);

  return `stmt:${digest}`;
}

const BANKS: { name: string; patterns: RegExp[] }[] = [
  { name: 'Banco Inter', patterns: [/banco\s+inter/i, /\binter\b.*extrato/i, /077\s*-\s*inter/i] },
  { name: 'Nubank', patterns: [/nu\s*pagamentos/i, /\bnubank\b/i] },
  { name: 'Itau', patterns: [/ita[úu]\s+unibanco/i, /\bita[úu]\b/i] },
  { name: 'Bradesco', patterns: [/bradesco/i] },
  { name: 'Banco do Brasil', patterns: [/banco\s+do\s+brasil/i, /\bbb\b.*extrato/i] },
  { name: 'Caixa', patterns: [/caixa\s+econ[oô]mica/i] },
  { name: 'Santander', patterns: [/santander/i] },
  { name: 'C6 Bank', patterns: [/c6\s*bank/i] },
];

function detectBank(lines: string[]): string | null {
  // O nome do banco costuma estar no topo; olhar as primeiras linhas evita
  // falso positivo por um "Itau" que aparece na descricao de uma transferencia.
  const header = lines.slice(0, 25).join(' ');
  return BANKS.find((bank) => bank.patterns.some((p) => p.test(header)))?.name ?? null;
}

/** Ano de referencia para linhas com data curta (`15/07`). */
function guessYear(lines: string[]): number {
  const match = lines.join(' ').match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : new Date().getFullYear();
}
