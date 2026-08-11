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
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import {
  budgetStatus,
  computeCategorySpend,
  projectCashflow,
  toYearMonth,
} from '@finflow/shared';
import { Ctx, type RequestContext } from '../auth/auth.types';
import { MonthQueryDto, YEAR_MONTH_REGEX } from '../common/dto';
import { SnapshotService } from '../domain/snapshot.service';
import { PrismaService } from '../prisma/prisma.service';

export class CreateBudgetDto {
  @IsString() categoryId!: string;
  /** `null`/ausente = orcamento recorrente, valido para todo mes. */
  @IsOptional() @Matches(YEAR_MONTH_REGEX) month?: string;
  /** Limite em CENTAVOS. */
  @IsInt() @Min(0) limitAmount!: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) alertThreshold?: number;
  @IsOptional() @IsBoolean() rollover?: boolean;
}

export class UpdateBudgetDto {
  @IsOptional() @IsInt() @Min(0) limitAmount?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) alertThreshold?: number;
  @IsOptional() @IsBoolean() rollover?: boolean;
}

@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: SnapshotService,
  ) {}

  /**
   * Orcamentos do mes ja cruzados com o gasto realizado.
   *
   * O gasto vem da projecao (e nao de um `SUM` direto) porque precisa incluir
   * as compras no cartao do mes corrente, que ainda nao sairam do caixa mas ja
   * consumiram o orcamento da categoria.
   */
  async list(organizationId: string, month?: string) {
    const snapshot = await this.snapshots.load(organizationId);
    const target = month ?? toYearMonth(snapshot.today);

    const projection = projectCashflow({ ...snapshot, from: target, months: 1 });
    const spendByCategory = projection.months[0]?.byCategory ?? {};

    const rows = computeCategorySpend({
      month: target,
      spendByCategory,
      categories: snapshot.categories,
      budgets: snapshot.budgets,
    });

    const budgetIdByCategory = new Map(
      snapshot.budgets
        .filter((b) => b.month === target || b.month === null)
        .map((b) => [b.categoryId, b.id]),
    );

    return {
      month: target,
      items: rows
        .filter((row) => row.budget !== null)
        .map((row) => ({ ...row, budgetId: budgetIdByCategory.get(row.categoryId) ?? null })),
      /** Categorias com gasto mas sem orcamento — candidatas a virar orcamento. */
      unbudgeted: rows.filter((row) => row.budget === null && row.spent > 0),
      totals: {
        limit: rows.reduce((sum, row) => sum + (row.budget ?? 0), 0),
        spent: rows.reduce((sum, row) => sum + row.spent, 0),
      },
    };
  }

  create(organizationId: string, dto: CreateBudgetDto) {
    return this.prisma.budget.create({
      data: {
        organizationId,
        categoryId: dto.categoryId,
        month: dto.month ?? null,
        limitAmount: dto.limitAmount,
        alertThreshold: dto.alertThreshold ?? 80,
        rollover: dto.rollover ?? false,
      },
    });
  }

  async update(organizationId: string, id: string, dto: UpdateBudgetDto) {
    await this.prisma.budget.updateMany({ where: { id, organizationId }, data: { ...dto } });
    return this.prisma.budget.findFirstOrThrow({ where: { id, organizationId } });
  }

  async remove(organizationId: string, id: string) {
    await this.prisma.budget.deleteMany({ where: { id, organizationId } });
    return { id, deleted: true };
  }
}

@ApiTags('budgets')
@Controller('budgets')
export class BudgetsController {
  constructor(private readonly service: BudgetsService) {}

  @Get()
  @ApiOperation({ summary: 'Orcamentos do mes com gasto realizado e status.' })
  list(@Ctx() ctx: RequestContext, @Query() query: MonthQueryDto) {
    return this.service.list(ctx.organizationId, query.month);
  }

  @Post()
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateBudgetDto) {
    return this.service.create(ctx.organizationId, dto);
  }

  @Patch(':id')
  update(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body() dto: UpdateBudgetDto) {
    return this.service.update(ctx.organizationId, id, dto);
  }

  @Delete(':id')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.service.remove(ctx.organizationId, id);
  }
}

@Module({
  controllers: [BudgetsController],
  providers: [BudgetsService],
  exports: [BudgetsService],
})
export class BudgetsModule {}

export { budgetStatus };
