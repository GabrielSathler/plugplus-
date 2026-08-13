import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Module,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { addDays, today as todayIn } from '@finflow/shared';
import { Ctx, Public, type RequestContext } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { AGGREGATOR_PORT, type AggregatorPort } from './aggregator.port';
import { parseCsv, parseOfx } from './ofx.parser';
import { StatementService } from './statements/statement.service';
import { StatementsController } from './statements/statements.controller';
import { PluggyProvider } from './providers/pluggy.provider';
import { SandboxAggregatorProvider } from './providers/sandbox.provider';

/* --------------------------------- DTOs ---------------------------------- */

export class RegisterConnectionDto {
  @IsString() @MaxLength(80) institutionName!: string;
  /** Id do item/link devolvido pelo widget do provider. */
  @IsString() externalItemId!: string;
  @IsOptional() @IsIn(['PLUGGY', 'BELVO', 'KLAVI', 'SANDBOX', 'MANUAL_OFX']) provider?: string;
}

export class ImportFileDto {
  @IsString() content!: string;
  @IsString() accountId!: string;
  @IsOptional() @IsIn(['OFX', 'CSV']) format?: string;
}

/* -------------------------------- Service -------------------------------- */

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AGGREGATOR_PORT) private readonly aggregator: AggregatorPort,
  ) {}

  listConnections(organizationId: string) {
    return this.prisma.bankConnection.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  createConnectToken(organizationId: string) {
    return this.aggregator.createConnectToken({ organizationId });
  }

  /**
   * Registra o vinculo depois que o usuario concluiu o consentimento no widget.
   *
   * O prazo do consentimento vem do PROVIDER, nao de uma constante nossa: desde
   * a Resolucao Conjunta 7/2023 ele e negociado entre instituicao e cliente e
   * pode ser indeterminado. Os 365 dias abaixo sao apenas o palpite usado
   * quando o provider nao informa nada — o valor real deve sobrescrever isso na
   * primeira sincronizacao. Guardamos a data para avisar ANTES de a
   * sincronizacao parar; descobrir pela ausencia de lancamentos e o pior jeito.
   */
  async registerConnection(organizationId: string, dto: RegisterConnectionDto) {
    return this.prisma.bankConnection.create({
      data: {
        organizationId,
        provider: dto.provider ?? this.aggregator.name,
        institutionName: dto.institutionName,
        externalItemId: dto.externalItemId,
        status: 'CONNECTED',
        consentExpiresAt: addDays(todayIn(), 365),
        lastSyncAt: new Date(),
      },
    });
  }

  /**
   * Puxa contas e lancamentos do provider e concilia com a base local.
   *
   * Deduplicacao por `externalId`: sincronizar duas vezes a mesma janela nao
   * pode duplicar lancamento nem falhar. O indice unico
   * `(organizationId, externalId)` garante a integridade no banco, e
   * `rejectKnown` filtra o que ja existe ANTES do insert — ver o porque la.
   */
  async sync(organizationId: string, connectionId: string) {
    const connection = await this.prisma.bankConnection.findFirstOrThrow({
      where: { id: connectionId, organizationId },
    });
    if (!connection.externalItemId) {
      throw new BadRequestException('Conexao sem item externo vinculado.');
    }

    await this.prisma.bankConnection.update({
      where: { id: connection.id },
      data: { status: 'SYNCING' },
    });

    try {
      const accounts = await this.aggregator.listAccounts(connection.externalItemId);
      const today = todayIn();
      const from = addDays(today, -90);

      let imported = 0;

      for (const account of accounts) {
        const local = await this.upsertAccount(organizationId, account);
        const { transactions } = await this.aggregator.listTransactions({
          itemId: connection.externalItemId,
          accountId: account.externalId,
          from,
          to: today,
        });

        const fresh = await this.rejectKnown(
          organizationId,
          transactions.map((tx) => ({ ...tx, externalId: tx.externalId })),
        );

        const result = await this.prisma.transaction.createMany({
          data: fresh.map((tx) => ({
            organizationId,
            description: tx.description,
            merchant: tx.merchant,
            amount: tx.amount,
            type: tx.type,
            paymentMethod: tx.paymentMethod,
            date: tx.date,
            accountId: account.kind === 'BANK' ? local.id : null,
            creditCardId: account.kind === 'CREDIT' ? local.id : null,
            status: 'POSTED',
            source: 'OPEN_FINANCE',
            externalId: tx.externalId,
            installmentNumber: tx.installment?.number ?? null,
            installmentTotal: tx.installment?.total ?? null,
            installmentGroupId: tx.installment?.groupId ?? null,
          })),
        });
        imported += result.count;
      }

      await this.applyCategorizationRules(organizationId);

      await this.prisma.bankConnection.update({
        where: { id: connection.id },
        data: {
          status: 'CONNECTED',
          lastSyncAt: new Date(),
          accountsLinked: accounts.length,
          lastError: null,
        },
      });

      return { connectionId: connection.id, accounts: accounts.length, imported };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido.';
      await this.prisma.bankConnection.update({
        where: { id: connection.id },
        data: { status: 'ERROR', lastError: message },
      });
      throw error;
    }
  }

  private async upsertAccount(
    organizationId: string,
    account: Awaited<ReturnType<AggregatorPort['listAccounts']>>[number],
  ) {
    if (account.kind === 'CREDIT' && account.creditCard) {
      const existing = await this.prisma.creditCard.findFirst({
        where: { organizationId, name: account.name },
      });
      if (existing) return existing;

      return this.prisma.creditCard.create({
        data: {
          organizationId,
          name: account.name,
          brand: account.creditCard.brand,
          lastFour: account.creditCard.lastFour,
          institution: account.institution,
          limitAmount: account.creditCard.limit,
          closingDay: account.creditCard.closingDay,
          dueDay: account.creditCard.dueDay,
        },
      });
    }

    const existing = await this.prisma.account.findFirst({
      where: { organizationId, name: account.name },
    });
    if (existing) {
      return this.prisma.account.update({
        where: { id: existing.id },
        data: { currentBalance: account.balance },
      });
    }

    return this.prisma.account.create({
      data: {
        organizationId,
        name: account.name,
        type: 'CHECKING',
        institution: account.institution,
        accountNumber: account.number,
        currentBalance: account.balance,
        openingBalance: account.balance,
      },
    });
  }

  async disconnect(organizationId: string, connectionId: string) {
    await this.prisma.bankConnection.updateMany({
      where: { id: connectionId, organizationId },
      data: { status: 'DISCONNECTED' },
    });
    return { id: connectionId, disconnected: true };
  }

  /** Importa extrato OFX ou CSV para uma conta ja cadastrada. */
  async importFile(organizationId: string, dto: ImportFileDto) {
    await this.prisma.account.findFirstOrThrow({
      where: { id: dto.accountId, organizationId },
    });

    const format = dto.format ?? (dto.content.includes('<OFX>') ? 'OFX' : 'CSV');

    const rows =
      format === 'OFX'
        ? parseOfx(dto.content).transactions.map((tx) => ({
            externalId: `ofx:${dto.accountId}:${tx.externalId}`,
            description: tx.description,
            amount: tx.amount,
            type: tx.type,
            date: tx.date,
          }))
        : parseCsv(dto.content).rows.map((tx, index) => ({
            externalId: `csv:${dto.accountId}:${tx.date}:${tx.amount}:${index}`,
            description: tx.description,
            amount: tx.amount,
            type: tx.type,
            date: tx.date,
          }));

    const fresh = await this.rejectKnown(organizationId, rows);

    const result = await this.prisma.transaction.createMany({
      data: fresh.map((row) => ({
        organizationId,
        description: row.description,
        amount: row.amount,
        type: row.type,
        paymentMethod: 'DEBIT',
        date: row.date,
        accountId: dto.accountId,
        status: 'POSTED',
        source: format === 'OFX' ? 'IMPORT_OFX' : 'IMPORT_CSV',
        externalId: row.externalId,
      })),
    });

    await this.applyCategorizationRules(organizationId);
    return {
      format,
      parsed: rows.length,
      imported: result.count,
      skipped: rows.length - result.count,
    };
  }

  /**
   * Remove do lote o que ja existe, comparando `externalId`.
   *
   * Reimportar e o caso NORMAL, nao a excecao: o extrato exportado todo mes
   * cobre 90 dias e sempre se sobrepoe ao anterior; a sincronizacao do
   * agregador reencontra a mesma janela. O usuario espera que o repetido seja
   * ignorado e o novo entre — nao um erro que aborta o lote inteiro.
   *
   * Filtrar antes do insert em vez de confiar em `skipDuplicates` porque essa
   * opcao do Prisma nao existe no SQLite; com ela o codigo funcionaria em
   * Postgres e quebraria aqui. O indice unico continua sendo a garantia final
   * contra corrida entre duas importacoes simultaneas.
   */
  private async rejectKnown<T extends { externalId: string }>(
    organizationId: string,
    rows: T[],
  ): Promise<T[]> {
    if (rows.length === 0) return [];

    const known = await this.prisma.transaction.findMany({
      where: { organizationId, externalId: { in: rows.map((row) => row.externalId) } },
      select: { externalId: true },
    });

    const seen = new Set(known.map((row) => row.externalId));
    // Um mesmo lote pode trazer o id repetido (arquivo mal formado); o Set
    // acumulado descarta a segunda ocorrencia tambem.
    return rows.filter((row) => {
      if (seen.has(row.externalId)) return false;
      seen.add(row.externalId);
      return true;
    });
  }

  /**
   * Categoriza automaticamente o que chegou sem categoria.
   *
   * Roda depois de toda importacao. So toca em `categoryId = null`: uma vez que
   * a pessoa classificou algo a mao, nenhuma regra pode desfazer isso.
   */
  async applyCategorizationRules(organizationId: string): Promise<number> {
    const [rules, uncategorized] = await Promise.all([
      this.prisma.categorizationRule.findMany({
        where: { organizationId, isActive: true },
        orderBy: { priority: 'asc' },
      }),
      this.prisma.transaction.findMany({
        where: { organizationId, categoryId: null },
        select: { id: true, description: true, merchant: true },
      }),
    ]);

    if (rules.length === 0 || uncategorized.length === 0) return 0;

    let updated = 0;
    for (const transaction of uncategorized) {
      for (const rule of rules) {
        const haystack =
          rule.matchField === 'MERCHANT'
            ? (transaction.merchant ?? '')
            : transaction.description;
        if (!matches(haystack, rule.matchType, rule.pattern)) continue;

        await this.prisma.transaction.update({
          where: { id: transaction.id },
          data: { categoryId: rule.categoryId },
        });
        updated += 1;
        break; // Primeira regra que casa vence — prioridade ja ordenou a lista.
      }
    }
    return updated;
  }

  /** Processa o evento do provider. Chamado apos a assinatura ser validada. */
  async handleWebhook(rawBody: string, headers: Record<string, string | undefined>) {
    if (!this.aggregator.verifyWebhook({ rawBody, headers })) {
      throw new UnauthorizedException('Assinatura de webhook invalida.');
    }

    const event = this.aggregator.parseWebhook(JSON.parse(rawBody));
    if (!event) return { handled: false };

    const connection = await this.prisma.bankConnection.findFirst({
      where: { externalItemId: event.itemId },
    });
    if (!connection) return { handled: false, reason: 'Item desconhecido.' };

    switch (event.kind) {
      case 'CONSENT_EXPIRED':
        await this.prisma.bankConnection.update({
          where: { id: connection.id },
          data: { status: 'CONSENT_EXPIRED' },
        });
        break;
      case 'ITEM_ERROR':
        await this.prisma.bankConnection.update({
          where: { id: connection.id },
          data: { status: 'NEEDS_ACTION', lastError: event.message },
        });
        break;
      default:
        // Sincronizar dentro do handler faria o provider esperar pela nossa
        // importacao inteira e disparar retry por timeout. Em producao isto
        // vira um enfileiramento; aqui o efeito é registrado e o 200 volta ja.
        this.logger.log(`Item ${event.itemId} atualizado — sincronizacao pendente.`);
        await this.prisma.bankConnection.update({
          where: { id: connection.id },
          data: { lastSyncAt: new Date() },
        });
    }

    return { handled: true, kind: event.kind };
  }
}

function matches(haystack: string, matchType: string, pattern: string): boolean {
  const value = haystack.toLowerCase();
  const needle = pattern.toLowerCase();
  switch (matchType) {
    case 'EQUALS':
      return value === needle;
    case 'STARTS_WITH':
      return value.startsWith(needle);
    case 'REGEX':
      try {
        return new RegExp(pattern, 'i').test(haystack);
      } catch {
        return false; // Regex invalida cadastrada pelo usuario nao derruba a importacao.
      }
    default:
      return value.includes(needle);
  }
}

/* ------------------------------- Controller ------------------------------ */

@ApiTags('integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly service: IntegrationsService) {}

  @Get('connections')
  @ApiOperation({ summary: 'Instituicoes conectadas e status do consentimento.' })
  connections(@Ctx() ctx: RequestContext) {
    return this.service.listConnections(ctx.organizationId);
  }

  @Post('connect-token')
  @ApiOperation({ summary: 'Token efemero para o widget de consentimento do provider.' })
  connectToken(@Ctx() ctx: RequestContext) {
    return this.service.createConnectToken(ctx.organizationId);
  }

  @Post('connections')
  @ApiOperation({ summary: 'Registra o vinculo apos o consentimento.' })
  register(@Ctx() ctx: RequestContext, @Body() dto: RegisterConnectionDto) {
    return this.service.registerConnection(ctx.organizationId, dto);
  }

  @Post('connections/:id/sync')
  @ApiOperation({ summary: 'Puxa contas e lancamentos da instituicao.' })
  sync(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.service.sync(ctx.organizationId, id);
  }

  @Delete('connections/:id')
  disconnect(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.service.disconnect(ctx.organizationId, id);
  }

  @Post('import')
  @ApiOperation({ summary: 'Importa extrato OFX ou CSV para uma conta.' })
  import(@Ctx() ctx: RequestContext, @Body() dto: ImportFileDto) {
    return this.service.importFile(ctx.organizationId, dto);
  }

  @Post('recategorize')
  @ApiOperation({ summary: 'Reaplica as regras de categorizacao nos lancamentos sem categoria.' })
  async recategorize(@Ctx() ctx: RequestContext) {
    const updated = await this.service.applyCategorizationRules(ctx.organizationId);
    return { updated };
  }

  /**
   * Webhook do agregador.
   *
   * `@Public` porque o provider nao carrega o JWT do usuario — a autenticacao e
   * a assinatura HMAC do corpo, verificada dentro do handler.
   */
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recebe eventos do agregador (autenticado por assinatura HMAC).' })
  webhook(@Body() body: unknown, @Headers() headers: Record<string, string | undefined>) {
    return this.service.handleWebhook(JSON.stringify(body), headers);
  }
}

/**
 * O provider ativo e escolhido em tempo de boot.
 *
 * Sem credencial da Pluggy o app sobe no sandbox em vez de quebrar — o
 * protótipo precisa rodar em qualquer maquina. `INTEGRATION_PROVIDER=sandbox`
 * forca o sandbox mesmo com credencial presente, util para desenvolver offline.
 */
@Module({
  controllers: [IntegrationsController, StatementsController],
  providers: [
    IntegrationsService,
    StatementService,
    PluggyProvider,
    SandboxAggregatorProvider,
    {
      provide: AGGREGATOR_PORT,
      inject: [PluggyProvider, SandboxAggregatorProvider],
      useFactory: (pluggy: PluggyProvider, sandbox: SandboxAggregatorProvider): AggregatorPort => {
        const forced = process.env.INTEGRATION_PROVIDER?.toLowerCase();
        if (forced === 'sandbox') return sandbox;
        if (forced === 'pluggy' || PluggyProvider.isConfigured()) return pluggy;
        new Logger('IntegrationsModule').warn(
          'Pluggy sem credenciais — usando o provider de sandbox.',
        );
        return sandbox;
      },
    },
  ],
  exports: [IntegrationsService, AGGREGATOR_PORT],
})
export class IntegrationsModule {}
