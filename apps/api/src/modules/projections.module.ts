import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { projectCashflow, toYearMonth, type YearMonth } from '@finflow/shared';
import { Ctx, type RequestContext } from '../auth/auth.types';
import { HorizonQueryDto } from '../common/dto';
import { SnapshotService } from '../domain/snapshot.service';

export class ProjectionQueryDto extends HorizonQueryDto {
  /**
   * Ids de cenario separados por virgula. Ausente = usa os cenarios marcados
   * como ativos; `none` = projecao limpa, sem nenhum cenario.
   */
  @IsOptional() @IsString() scenarios?: string;
}

@Injectable()
export class ProjectionsService {
  constructor(private readonly snapshots: SnapshotService) {}

  async cashflow(organizationId: string, query: ProjectionQueryDto) {
    const snapshot = await this.snapshots.load(organizationId);
    const from = (query.from ?? toYearMonth(snapshot.today)) as YearMonth;
    const months = query.months ?? snapshot.organization.projectionHorizon;

    const scenarios = selectScenarios(snapshot.scenarios, query.scenarios);
    const projection = projectCashflow({ ...snapshot, scenarios, from, months });

    return {
      from,
      months: projection.months.map((month) => ({
        month: month.month,
        openingBalance: month.openingBalance,
        income: month.income,
        // `expenses` JA inclui `cardPayments`; a tabela da tela de Projecoes
        // mostra a fatura como coluna de detalhe, nao como parcela somada.
        expenses: month.expenses,
        cardPayments: month.cardPayments,
        net: month.net,
        closingBalance: month.closingBalance,
        isProjected: month.isProjected,
        invoices: month.invoices,
      })),
      lowestBalance: projection.lowestBalance,
      lowestBalanceMonth: projection.lowestBalanceMonth,
      monthsUntilNegative: projection.monthsUntilNegative,
      appliedScenarios: scenarios.map((s) => ({ id: s.id, name: s.name, color: s.color })),
    };
  }
}

function selectScenarios<T extends { id: string; isActive: boolean }>(
  all: readonly T[],
  filter?: string,
): T[] {
  if (filter === undefined) return all.filter((s) => s.isActive);
  if (filter === 'none' || filter === '') return [];
  const wanted = new Set(filter.split(',').map((id) => id.trim()));
  return all.filter((s) => wanted.has(s.id)).map((s) => ({ ...s, isActive: true }));
}

@ApiTags('projections')
@Controller('projections')
export class ProjectionsController {
  constructor(private readonly service: ProjectionsService) {}

  @Get('cashflow')
  @ApiOperation({
    summary: 'Projecao de fluxo de caixa mes a mes.',
    description:
      'Compras no credito nao saem do caixa na data da compra: entram na fatura e ' +
      'debitam no vencimento. Por isso `cardPayments` e um subconjunto de `expenses`.',
  })
  cashflow(@Ctx() ctx: RequestContext, @Query() query: ProjectionQueryDto) {
    return this.service.cashflow(ctx.organizationId, query);
  }
}

@Module({
  controllers: [ProjectionsController],
  providers: [ProjectionsService],
  exports: [ProjectionsService],
})
export class ProjectionsModule {}
