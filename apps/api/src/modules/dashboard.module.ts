import { Controller, Get, Global, Module, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Ctx, type RequestContext } from '../auth/auth.types';
import { MonthQueryDto } from '../common/dto';
import { AlertsService } from './alerts.service';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Tela "Visao geral": KPIs, series, categorias e alertas.' })
  overview(@Ctx() ctx: RequestContext, @Query() query: MonthQueryDto) {
    return this.service.overview(ctx.organizationId, query.month);
  }

  @Get('checking-account')
  @ApiOperation({ summary: 'Tela "Conta corrente": entradas, saidas e recorrencias.' })
  checking(@Ctx() ctx: RequestContext, @Query() query: MonthQueryDto) {
    return this.service.checkingAccount(ctx.organizationId, query.month);
  }

  @Get('credit-card')
  @ApiOperation({ summary: 'Tela "Cartao de credito": fatura aberta, composicao e historico.' })
  creditCard(
    @Ctx() ctx: RequestContext,
    @Query() query: MonthQueryDto,
    @Query('cardId') cardId?: string,
  ) {
    return this.service.creditCard(ctx.organizationId, cardId, query.month);
  }
}

@ApiTags('alerts')
@Controller('alerts')
export class AlertsController {
  constructor(private readonly service: AlertsService) {}

  @Get()
  @ApiOperation({ summary: 'Avisos derivados do estado atual (nunca persistidos).' })
  list(@Ctx() ctx: RequestContext, @Query() query: MonthQueryDto) {
    return this.service.list(ctx.organizationId, query.month);
  }
}

@Global()
@Module({
  controllers: [DashboardController, AlertsController],
  providers: [DashboardService, AlertsService],
  exports: [DashboardService, AlertsService],
})
export class DashboardModule {}
