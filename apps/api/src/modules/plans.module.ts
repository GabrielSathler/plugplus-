import {
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
import {
  IsHexColor,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  PAYMENT_METHODS,
  SPENDING_PLAN_ITEM_STATUSES,
  SPENDING_PLAN_STATUSES,
  endOfMonth,
  pendingReconciliation,
  projectCashflow,
  startOfMonth,
  summarizePlan,
  toYearMonth,
  totalPlanned,
  type YearMonth,
} from '@finflow/shared';
import { Ctx, type RequestContext } from '../auth/auth.types';
import { ISO_DATE_REGEX, MonthQueryDto } from '../common/dto';
import { SnapshotService, toSpendingPlan } from '../domain/snapshot.service';
import { PrismaService } from '../prisma/prisma.service';

/* --------------------------------- DTOs ---------------------------------- */

export class CreatePlanDto {
  @IsString() @MaxLength(80) name!: string;
  @Matches(ISO_DATE_REGEX, { message: 'startDate deve ser YYYY-MM-DD.' }) startDate!: string;
  /** Ausente = plano de um dia so. */
  @IsOptional() @Matches(ISO_DATE_REGEX) endDate?: string;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class UpdatePlanDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @Matches(ISO_DATE_REGEX) startDate?: string;
  @IsOptional() @Matches(ISO_DATE_REGEX) endDate?: string;
  @IsOptional() @IsIn(SPENDING_PLAN_STATUSES) status?: string;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class CreatePlanItemDto {
  @IsString() @MaxLength(160) description!: string;
  /** Valor estimado em CENTAVOS. */
  @IsInt() @Min(1) amount!: number;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsString() creditCardId?: string;
  @IsOptional() @IsIn(PAYMENT_METHODS) paymentMethod?: string;
  @IsOptional() @IsInt() @Min(1) @Max(48) installments?: number;
  @IsOptional() @Matches(ISO_DATE_REGEX) date?: string;
}

export class UpdatePlanItemDto extends CreatePlanItemDto {
  @IsOptional() @IsString() @MaxLength(160) declare description: string;
  @IsOptional() @IsInt() @Min(1) declare amount: number;
  @IsOptional() @IsIn(SPENDING_PLAN_ITEM_STATUSES) status?: string;
  /** Lancamento real que confirma este item. */
  @IsOptional() @IsString() matchedTransactionId?: string;
}

/* -------------------------------- Service -------------------------------- */

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: SnapshotService,
  ) {}

  /**
   * Planos com o resumo calculado: total, quanto cai em fatura, quanto sai da
   * conta e em que competencia o caixa sente cada parte.
   */
  async list(organizationId: string, month?: string) {
    const snapshot = await this.snapshots.load(organizationId);
    const target = (month ?? toYearMonth(snapshot.today)) as YearMonth;
    const cardsById = Object.fromEntries(snapshot.cards.map((card) => [card.id, card]));

    const plans = await this.prisma.spendingPlan.findMany({
      where: { organizationId },
      include: {
        items: {
          orderBy: { sortOrder: 'asc' },
          include: {
            category: { select: { id: true, name: true, color: true } },
            account: { select: { id: true, name: true, accountNumber: true } },
            creditCard: { select: { id: true, name: true, lastFour: true } },
          },
        },
      },
      orderBy: [{ status: 'asc' }, { startDate: 'asc' }],
    });

    const items = plans.map((plan) => ({
      ...plan,
      summary: summarizePlan({
        plan: toSpendingPlan(plan),
        cards: cardsById,
        transactions: snapshot.transactions,
        today: snapshot.today,
      }),
    }));

    return {
      month: target,
      today: snapshot.today,
      items,
      totals: this.totals(snapshot, target),
      /** Itens vencidos esperando confirmacao do que de fato aconteceu. */
      awaitingReconciliation: pendingReconciliation(snapshot.plans, snapshot.today).length,
    };
  }

  /**
   * Cabecalho da tela: quanto foi programado e o que sobra depois disso.
   *
   * "Disponivel depois dos planos" e o numero que a tela existe para mostrar —
   * o saldo projetado do mes ja descontando o que voce decidiu gastar.
   */
  private totals(snapshot: Awaited<ReturnType<SnapshotService['load']>>, month: YearMonth) {
    const cardsById = Object.fromEntries(snapshot.cards.map((card) => [card.id, card]));

    let toInvoice = 0;
    let toAccount = 0;
    for (const plan of snapshot.plans) {
      if (plan.status !== 'PLANNED') continue;
      const summary = summarizePlan({ plan, cards: cardsById, today: snapshot.today });
      toInvoice += summary.toInvoice;
      toAccount += summary.toAccount;
    }

    // O numero que a tela existe para mostrar: a sobra do mes ja descontando o
    // que voce decidiu gastar. Projetamos duas vezes — com e sem planos — em
    // vez de subtrair, porque um plano no cartao nao debita no mes da compra e
    // uma subtracao simples erraria justamente o caso que o produto resolve.
    const withPlans = projectCashflow({ ...snapshot, from: month, months: 1 });
    const withoutPlans = projectCashflow({ ...snapshot, plans: [], from: month, months: 1 });

    return {
      plannedThisMonth: totalPlanned(snapshot.plans, snapshot.today, month),
      plannedTotal: totalPlanned(snapshot.plans, snapshot.today),
      toInvoice,
      toAccount,
      surplusBeforePlans: withoutPlans.months[0]?.net ?? 0,
      surplusAfterPlans: withPlans.months[0]?.net ?? 0,
    };
  }

  async get(organizationId: string, id: string) {
    const [snapshot, plan] = await Promise.all([
      this.snapshots.load(organizationId),
      this.prisma.spendingPlan.findFirstOrThrow({
        where: { id, organizationId },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      }),
    ]);

    return {
      ...plan,
      summary: summarizePlan({
        plan: toSpendingPlan(plan),
        cards: Object.fromEntries(snapshot.cards.map((card) => [card.id, card])),
        transactions: snapshot.transactions,
        today: snapshot.today,
      }),
    };
  }

  create(organizationId: string, dto: CreatePlanDto) {
    return this.prisma.spendingPlan.create({
      data: {
        organizationId,
        name: dto.name,
        startDate: dto.startDate,
        // Plano de um dia so tem fim igual ao inicio; e o caso mais comum
        // ("hoje a noite") e nao deveria exigir preencher duas datas iguais.
        endDate: dto.endDate ?? dto.startDate,
        color: dto.color ?? '#8257E5',
        notes: dto.notes ?? null,
      },
      include: { items: true },
    });
  }

  async update(organizationId: string, id: string, dto: UpdatePlanDto) {
    await this.prisma.spendingPlan.updateMany({ where: { id, organizationId }, data: { ...dto } });
    return this.get(organizationId, id);
  }

  async remove(organizationId: string, id: string) {
    await this.prisma.spendingPlan.deleteMany({ where: { id, organizationId } });
    return { id, deleted: true };
  }

  async addItem(organizationId: string, planId: string, dto: CreatePlanItemDto) {
    await this.prisma.spendingPlan.findFirstOrThrow({ where: { id: planId, organizationId } });
    const count = await this.prisma.spendingPlanItem.count({ where: { planId } });

    return this.prisma.spendingPlanItem.create({
      data: {
        planId,
        description: dto.description,
        amount: dto.amount,
        categoryId: dto.categoryId ?? null,
        accountId: dto.accountId ?? null,
        creditCardId: dto.creditCardId ?? null,
        // Cartao informado implica compra no credito: e o unico caminho em que
        // o gasto vai para a fatura em vez de sair da conta.
        paymentMethod: dto.paymentMethod ?? (dto.creditCardId ? 'CREDIT' : 'PIX'),
        installments: dto.installments ?? 1,
        date: dto.date ?? null,
        sortOrder: count,
      },
    });
  }

  async updateItem(
    organizationId: string,
    planId: string,
    itemId: string,
    dto: UpdatePlanItemDto,
  ) {
    await this.prisma.spendingPlan.findFirstOrThrow({ where: { id: planId, organizationId } });
    await this.prisma.spendingPlanItem.updateMany({
      where: { id: itemId, planId },
      data: { ...dto },
    });
    return this.prisma.spendingPlanItem.findFirstOrThrow({ where: { id: itemId, planId } });
  }

  async removeItem(organizationId: string, planId: string, itemId: string) {
    await this.prisma.spendingPlan.findFirstOrThrow({ where: { id: planId, organizationId } });
    await this.prisma.spendingPlanItem.deleteMany({ where: { id: itemId, planId } });
    return { id: itemId, deleted: true };
  }

  /**
   * Sugere lancamentos reais que podem corresponder a um item pendente.
   *
   * Filtro simples e verificavel: mesma origem (conta ou cartao), dentro do
   * periodo do plano, ainda sem estar amarrado a outro item. A escolha final e
   * do usuario — casar automaticamente por proximidade de valor erraria em
   * silencio, e conciliacao errada e pior que conciliacao ausente.
   */
  async suggestMatches(organizationId: string, planId: string, itemId: string) {
    const plan = await this.prisma.spendingPlan.findFirstOrThrow({
      where: { id: planId, organizationId },
      include: { items: true },
    });
    const item = plan.items.find((row) => row.id === itemId);
    if (!item) return [];

    const alreadyMatched = plan.items
      .map((row) => row.matchedTransactionId)
      .filter((id): id is string => Boolean(id) && id !== item.matchedTransactionId);

    return this.prisma.transaction.findMany({
      where: {
        organizationId,
        type: 'EXPENSE',
        date: { gte: plan.startDate, lte: plan.endDate },
        id: { notIn: alreadyMatched },
        ...(item.creditCardId
          ? { creditCardId: item.creditCardId }
          : item.accountId
            ? { accountId: item.accountId }
            : {}),
      },
      orderBy: { date: 'asc' },
      take: 20,
      include: { category: { select: { id: true, name: true, color: true } } },
    });
  }

  /** Fecha o plano: nenhum item pendente volta a contar na projecao. */
  async close(organizationId: string, id: string) {
    await this.prisma.spendingPlan.updateMany({
      where: { id, organizationId },
      data: { status: 'CLOSED' },
    });
    return this.get(organizationId, id);
  }
}

/* ------------------------------- Controller ------------------------------ */

@ApiTags('plans')
@Controller('plans')
export class PlansController {
  constructor(private readonly service: PlansService) {}

  @Get()
  @ApiOperation({ summary: 'Planos de gasto com resumo de impacto no caixa.' })
  list(@Ctx() ctx: RequestContext, @Query() query: MonthQueryDto) {
    return this.service.list(ctx.organizationId, query.month);
  }

  @Get(':id')
  get(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.service.get(ctx.organizationId, id);
  }

  @Post()
  create(@Ctx() ctx: RequestContext, @Body() dto: CreatePlanDto) {
    return this.service.create(ctx.organizationId, dto);
  }

  @Patch(':id')
  update(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.service.update(ctx.organizationId, id, dto);
  }

  @Post(':id/close')
  @ApiOperation({ summary: 'Encerra o plano; itens pendentes param de contar.' })
  close(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.service.close(ctx.organizationId, id);
  }

  @Delete(':id')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.service.remove(ctx.organizationId, id);
  }

  @Post(':id/items')
  addItem(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body() dto: CreatePlanItemDto) {
    return this.service.addItem(ctx.organizationId, id, dto);
  }

  @Patch(':id/items/:itemId')
  updateItem(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdatePlanItemDto,
  ) {
    return this.service.updateItem(ctx.organizationId, id, itemId, dto);
  }

  @Get(':id/items/:itemId/matches')
  @ApiOperation({ summary: 'Lancamentos reais candidatos a confirmar o item.' })
  matches(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.service.suggestMatches(ctx.organizationId, id, itemId);
  }

  @Delete(':id/items/:itemId')
  removeItem(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.service.removeItem(ctx.organizationId, id, itemId);
  }
}

@Module({
  controllers: [PlansController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}

export { endOfMonth, startOfMonth };
