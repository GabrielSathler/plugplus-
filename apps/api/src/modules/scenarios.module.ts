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
  IsBoolean,
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
  SCENARIO_ITEM_KINDS,
  TRANSACTION_TYPES,
  projectCashflow,
  toYearMonth,
} from '@finflow/shared';
import { Ctx, type RequestContext } from '../auth/auth.types';
import { HorizonQueryDto, ISO_DATE_REGEX } from '../common/dto';
import { SnapshotService } from '../domain/snapshot.service';
import { PrismaService } from '../prisma/prisma.service';

export class CreateScenarioDto {
  @IsString() @MaxLength(80) name!: string;
  @IsOptional() @IsString() @MaxLength(240) description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsHexColor() color?: string;
}

export class UpdateScenarioDto extends CreateScenarioDto {
  @IsOptional() @IsString() @MaxLength(80) declare name: string;
}

export class CreateScenarioItemDto {
  @IsIn(SCENARIO_ITEM_KINDS) kind!: string;
  @IsString() @MaxLength(160) description!: string;
  /** Valor em CENTAVOS. Para INSTALLMENT, e o total da compra. */
  @IsInt() @Min(1) amount!: number;
  @IsOptional() @IsIn(TRANSACTION_TYPES) type?: string;
  @Matches(ISO_DATE_REGEX) startDate!: string;
  /** Parcelas (INSTALLMENT) ou meses de vigencia (RECURRING). */
  @IsOptional() @IsInt() @Min(1) @Max(48) months?: number;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsString() creditCardId?: string;
}

@Injectable()
export class ScenariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: SnapshotService,
  ) {}

  list(organizationId: string) {
    return this.prisma.scenario.findMany({
      where: { organizationId },
      include: { items: true },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });
  }

  create(organizationId: string, dto: CreateScenarioDto) {
    return this.prisma.scenario.create({
      data: { organizationId, ...dto },
      include: { items: true },
    });
  }

  async update(organizationId: string, id: string, dto: UpdateScenarioDto) {
    await this.prisma.scenario.updateMany({ where: { id, organizationId }, data: { ...dto } });
    return this.prisma.scenario.findFirstOrThrow({
      where: { id, organizationId },
      include: { items: true },
    });
  }

  async remove(organizationId: string, id: string) {
    await this.prisma.scenario.deleteMany({ where: { id, organizationId } });
    return { id, deleted: true };
  }

  async addItem(organizationId: string, scenarioId: string, dto: CreateScenarioItemDto) {
    await this.prisma.scenario.findFirstOrThrow({ where: { id: scenarioId, organizationId } });
    return this.prisma.scenarioItem.create({
      data: { scenarioId, type: 'EXPENSE', ...dto },
    });
  }

  async removeItem(organizationId: string, scenarioId: string, itemId: string) {
    await this.prisma.scenario.findFirstOrThrow({ where: { id: scenarioId, organizationId } });
    await this.prisma.scenarioItem.deleteMany({ where: { id: itemId, scenarioId } });
    return { id: itemId, deleted: true };
  }

  /**
   * Impacto isolado de um cenario: projeta com e sem ele e devolve a diferenca.
   *
   * Roda o cenario sozinho (ignorando os demais ativos) para responder "quanto
   * ESTE plano custa", que e a pergunta da tela de Cenarios. O empilhamento de
   * varios cenarios ativos aparece na tela de Projecoes.
   */
  async impact(organizationId: string, scenarioId: string, from?: string, months = 12) {
    const snapshot = await this.snapshots.load(organizationId);
    const scenario = snapshot.scenarios.find((s) => s.id === scenarioId);
    const start = from ?? toYearMonth(snapshot.today);

    const baseline = projectCashflow({ ...snapshot, scenarios: [], from: start, months });
    const withScenario = projectCashflow({
      ...snapshot,
      scenarios: scenario ? [{ ...scenario, isActive: true }] : [],
      from: start,
      months,
    });

    return {
      scenarioId,
      from: start,
      months: withScenario.months.map((month, index) => ({
        month: month.month,
        baselineBalance: baseline.months[index]?.closingBalance ?? 0,
        scenarioBalance: month.closingBalance,
        delta: month.closingBalance - (baseline.months[index]?.closingBalance ?? 0),
      })),
      totalImpact:
        (withScenario.months.at(-1)?.closingBalance ?? 0) -
        (baseline.months.at(-1)?.closingBalance ?? 0),
      lowestBalance: withScenario.lowestBalance,
      lowestBalanceMonth: withScenario.lowestBalanceMonth,
    };
  }
}

@ApiTags('scenarios')
@Controller('scenarios')
export class ScenariosController {
  constructor(private readonly service: ScenariosService) {}

  @Get()
  @ApiOperation({ summary: 'Simulacoes "e se" da organizacao.' })
  list(@Ctx() ctx: RequestContext) {
    return this.service.list(ctx.organizationId);
  }

  @Get(':id/impact')
  @ApiOperation({ summary: 'Diferenca de saldo que o cenario provoca, mes a mes.' })
  impact(@Ctx() ctx: RequestContext, @Param('id') id: string, @Query() query: HorizonQueryDto) {
    return this.service.impact(ctx.organizationId, id, query.from, query.months ?? 12);
  }

  @Post()
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateScenarioDto) {
    return this.service.create(ctx.organizationId, dto);
  }

  @Patch(':id')
  update(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body() dto: UpdateScenarioDto) {
    return this.service.update(ctx.organizationId, id, dto);
  }

  @Delete(':id')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.service.remove(ctx.organizationId, id);
  }

  @Post(':id/items')
  addItem(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: CreateScenarioItemDto,
  ) {
    return this.service.addItem(ctx.organizationId, id, dto);
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
  controllers: [ScenariosController],
  providers: [ScenariosService],
  exports: [ScenariosService],
})
export class ScenariosModule {}
