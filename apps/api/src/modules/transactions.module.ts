import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  Query,
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
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { Prisma } from '@prisma/client';
import {
  PAYMENT_METHODS,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
  buildInstallmentPlan,
  endOfMonth,
  resolveCycleForPurchase,
  startOfMonth,
} from '@finflow/shared';
import { Ctx, type RequestContext } from '../auth/auth.types';
import { ISO_DATE_REGEX, YEAR_MONTH_REGEX, paginate } from '../common/dto';
import { PrismaService } from '../prisma/prisma.service';
import { toCreditCard } from '../domain/snapshot.service';

/* --------------------------------- DTOs ---------------------------------- */

export class CreateTransactionDto {
  @IsString() @MaxLength(160) description!: string;
  @IsOptional() @IsString() @MaxLength(120) merchant?: string;

  /** Valor SEMPRE positivo, em CENTAVOS. Para parcelado, e o valor TOTAL da compra. */
  @IsInt() @Min(1) amount!: number;

  @IsIn(TRANSACTION_TYPES) type!: string;
  @IsIn(PAYMENT_METHODS) paymentMethod!: string;

  @Matches(ISO_DATE_REGEX, { message: 'date deve estar no formato YYYY-MM-DD.' })
  date!: string;

  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsString() creditCardId?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() transferAccountId?: string;

  @IsOptional() @IsIn(TRANSACTION_STATUSES) status?: string;

  /** Numero de parcelas. `> 1` expande a compra em N lancamentos. */
  @IsOptional() @IsInt() @Min(1) @Max(48) installments?: number;

  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
}

export class UpdateTransactionDto {
  @IsOptional() @IsString() @MaxLength(160) description?: string;
  @IsOptional() @IsString() @MaxLength(120) merchant?: string;
  @IsOptional() @IsInt() @Min(1) amount?: number;
  @IsOptional() @IsIn(TRANSACTION_TYPES) type?: string;
  @IsOptional() @IsIn(PAYMENT_METHODS) paymentMethod?: string;
  @IsOptional() @Matches(ISO_DATE_REGEX) date?: string;
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsString() creditCardId?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsIn(TRANSACTION_STATUSES) status?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
}

/** Filtros da tela de Transacoes (busca + chips Todas/Cartao/Conta/Parceladas). */
export class ListTransactionsDto {
  @IsOptional() @Matches(YEAR_MONTH_REGEX) month?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsString() creditCardId?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsIn(TRANSACTION_TYPES) type?: string;

  /** `CARD` | `ACCOUNT` | `INSTALLMENTS` — atalhos dos chips de filtro. */
  @IsOptional() @IsIn(['CARD', 'ACCOUNT', 'INSTALLMENTS']) scope?: string;

  @IsOptional() @Type(() => Boolean) @IsBoolean() includeProjected?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number = 50;
}

/* -------------------------------- Service -------------------------------- */

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, query: ListTransactionsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    const where: Prisma.TransactionWhereInput = { organizationId };

    if (query.month) {
      where.date = { gte: startOfMonth(query.month), lte: endOfMonth(query.month) };
    }
    if (query.accountId) where.accountId = query.accountId;
    if (query.creditCardId) where.creditCardId = query.creditCardId;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.type) where.type = query.type;

    if (query.scope === 'CARD') where.creditCardId = { not: null };
    if (query.scope === 'ACCOUNT') where.creditCardId = null;
    if (query.scope === 'INSTALLMENTS') where.installmentTotal = { gt: 1 };

    if (query.search) {
      const term = query.search.trim();
      // Busca por valor: "412" encontra R$ 412,00. O usuario digita o numero que
      // ve na tela, nao os centavos.
      const asAmount = Number(term.replace(/[^\d]/g, ''));
      where.OR = [
        { description: { contains: term } },
        { merchant: { contains: term } },
        ...(Number.isFinite(asAmount) && asAmount > 0
          ? [{ amount: asAmount * 100 }, { amount: asAmount }]
          : []),
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          category: { select: { id: true, name: true, color: true, icon: true } },
          account: { select: { id: true, name: true, institution: true, accountNumber: true } },
          creditCard: { select: { id: true, name: true, brand: true, lastFour: true } },
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return paginate(items, total, page, pageSize);
  }

  /**
   * Cria um lancamento. Compra parcelada vira N transacoes ligadas por
   * `installmentGroupId`, cada uma na data que a coloca na fatura certa.
   *
   * Expandimos na escrita (e nao so na projecao) porque a tela de Transacoes
   * precisa listar "Latam - parcela 2/12" como linha propria, e o usuario
   * espera editar ou excluir uma parcela individual.
   */
  async create(organizationId: string, dto: CreateTransactionDto) {
    const installments = dto.installments ?? 1;

    if (installments > 1) {
      if (!dto.creditCardId || dto.paymentMethod !== 'CREDIT') {
        throw new BadRequestException(
          'Parcelamento exige um cartao de credito e paymentMethod = CREDIT.',
        );
      }
      return this.createInstallments(organizationId, dto, installments);
    }

    if (dto.paymentMethod === 'CREDIT' && !dto.creditCardId) {
      throw new BadRequestException('Lancamento no credito exige creditCardId.');
    }
    if (dto.paymentMethod !== 'CREDIT' && !dto.accountId) {
      throw new BadRequestException('Lancamento fora do credito exige accountId.');
    }

    const created = await this.prisma.transaction.create({
      data: {
        organizationId,
        description: dto.description,
        merchant: dto.merchant ?? null,
        amount: dto.amount,
        type: dto.type,
        paymentMethod: dto.paymentMethod,
        date: dto.date,
        accountId: dto.accountId ?? null,
        creditCardId: dto.creditCardId ?? null,
        categoryId: dto.categoryId ?? null,
        transferAccountId: dto.transferAccountId ?? null,
        status: dto.status ?? 'POSTED',
        notes: dto.notes ?? null,
        tags: JSON.stringify(dto.tags ?? []),
      },
    });

    await this.applyBalanceEffect(created.accountId, created.type, created.amount, created.paymentMethod);
    return created;
  }

  private async createInstallments(
    organizationId: string,
    dto: CreateTransactionDto,
    installments: number,
  ) {
    const card = await this.prisma.creditCard.findFirstOrThrow({
      where: { id: dto.creditCardId!, organizationId },
    });

    const plan = buildInstallmentPlan({
      purchaseDate: dto.date,
      totalAmount: dto.amount,
      installments,
      card: toCreditCard(card),
    });

    const groupId = `ig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    // A data de cada parcela e o proprio fechamento do ciclo que a recebe. Isso
    // mantem `resolveCycleForPurchase` idempotente: reprocessar a transacao
    // devolve exatamente a mesma fatura.
    const created = await this.prisma.$transaction(
      plan.map((entry) =>
        this.prisma.transaction.create({
          data: {
            organizationId,
            description: `${dto.description} · parcela ${entry.installmentNumber}/${installments}`,
            merchant: dto.merchant ?? null,
            amount: entry.amount,
            type: dto.type,
            paymentMethod: 'CREDIT',
            date: entry.installmentNumber === 1 ? dto.date : entry.closingDate,
            creditCardId: dto.creditCardId!,
            categoryId: dto.categoryId ?? null,
            status: entry.installmentNumber === 1 ? (dto.status ?? 'POSTED') : 'SCHEDULED',
            installmentNumber: entry.installmentNumber,
            installmentTotal: installments,
            installmentGroupId: groupId,
            notes: dto.notes ?? null,
            tags: JSON.stringify(dto.tags ?? []),
          },
        }),
      ),
    );

    return { installmentGroupId: groupId, items: created };
  }

  async update(organizationId: string, id: string, dto: UpdateTransactionDto) {
    // `tags` sai do spread porque no dominio e `string[]` e no SQLite e JSON.
    const { tags, ...rest } = dto;
    const data: Prisma.TransactionUpdateManyMutationInput = { ...rest };
    if (tags) data.tags = JSON.stringify(tags);
    await this.prisma.transaction.updateMany({ where: { id, organizationId }, data });
    return this.prisma.transaction.findFirstOrThrow({ where: { id, organizationId } });
  }

  /** `scope=group` apaga a compra parcelada inteira, nao so a parcela clicada. */
  async remove(organizationId: string, id: string, scope?: string) {
    const transaction = await this.prisma.transaction.findFirstOrThrow({
      where: { id, organizationId },
    });

    if (scope === 'group' && transaction.installmentGroupId) {
      const result = await this.prisma.transaction.deleteMany({
        where: { organizationId, installmentGroupId: transaction.installmentGroupId },
      });
      return { deleted: result.count, scope: 'group' };
    }

    await this.prisma.transaction.deleteMany({ where: { id, organizationId } });
    return { deleted: 1, scope: 'single' };
  }

  /** Em que fatura esta compra cairia — usado no preview do formulario. */
  async previewCycle(organizationId: string, cardId: string, date: string) {
    const card = await this.prisma.creditCard.findFirstOrThrow({
      where: { id: cardId, organizationId },
    });
    return resolveCycleForPurchase(date, toCreditCard(card));
  }

  /**
   * Ajusta o saldo da conta. Compra no credito nao mexe no saldo — ela vira
   * fatura, e a fatura debita no vencimento (ver ADR em projection.ts).
   */
  private async applyBalanceEffect(
    accountId: string | null,
    type: string,
    amount: number,
    paymentMethod: string,
  ): Promise<void> {
    if (!accountId || paymentMethod === 'CREDIT' || type === 'TRANSFER') return;
    await this.prisma.account.update({
      where: { id: accountId },
      data: { currentBalance: { increment: type === 'INCOME' ? amount : -amount } },
    });
  }
}

/* ------------------------------- Controller ------------------------------ */

@ApiTags('transactions')
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly service: TransactionsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista transacoes com filtros, busca e paginacao.' })
  list(@Ctx() ctx: RequestContext, @Query() query: ListTransactionsDto) {
    return this.service.list(ctx.organizationId, query);
  }

  @Get('preview-cycle')
  @ApiOperation({ summary: 'Em qual fatura uma compra cairia (preview do formulario).' })
  preview(
    @Ctx() ctx: RequestContext,
    @Query('cardId') cardId: string,
    @Query('date') date: string,
  ) {
    return this.service.previewCycle(ctx.organizationId, cardId, date);
  }

  @Post()
  @ApiOperation({ summary: 'Cria lancamento; `installments > 1` expande a compra.' })
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateTransactionDto) {
    return this.service.create(ctx.organizationId, dto);
  }

  @Patch(':id')
  update(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body() dto: UpdateTransactionDto) {
    return this.service.update(ctx.organizationId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove o lancamento; `?scope=group` remove a compra parcelada toda.' })
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string, @Query('scope') scope?: string) {
    return this.service.remove(ctx.organizationId, id, scope);
  }
}

@Module({
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
