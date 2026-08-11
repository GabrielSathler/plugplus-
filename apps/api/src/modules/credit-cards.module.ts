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
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CARD_BRANDS,
  cycleForReferenceMonth,
  cycleProgress,
  projectCardInvoices,
  toYearMonth,
  addMonthsToYearMonth,
} from '@finflow/shared';
import { Ctx, type RequestContext } from '../auth/auth.types';
import { HorizonQueryDto } from '../common/dto';
import { SnapshotService, toCreditCard } from '../domain/snapshot.service';
import { PrismaService } from '../prisma/prisma.service';

export class CreateCreditCardDto {
  @IsString() @MaxLength(80) name!: string;
  @IsIn(CARD_BRANDS) brand!: string;
  @IsOptional() @IsString() @Length(4, 4) lastFour?: string;
  @IsOptional() @IsString() @MaxLength(80) institution?: string;
  /** Limite em CENTAVOS. */
  @IsInt() @Min(0) limitAmount!: number;
  @IsInt() @Min(1) @Max(31) closingDay!: number;
  @IsInt() @Min(1) @Max(31) dueDay!: number;
  @IsOptional() @IsBoolean() closingDayInclusive?: boolean;
  @IsOptional() @IsString() paymentAccountId?: string;
  @IsOptional() @IsHexColor() color?: string;
}

export class UpdateCreditCardDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsIn(CARD_BRANDS) brand?: string;
  @IsOptional() @IsString() @Length(4, 4) lastFour?: string;
  @IsOptional() @IsString() @MaxLength(80) institution?: string;
  @IsOptional() @IsInt() @Min(0) limitAmount?: number;
  @IsOptional() @IsInt() @Min(1) @Max(31) closingDay?: number;
  @IsOptional() @IsInt() @Min(1) @Max(31) dueDay?: number;
  @IsOptional() @IsBoolean() closingDayInclusive?: boolean;
  @IsOptional() @IsString() paymentAccountId?: string;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Injectable()
export class CreditCardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: SnapshotService,
  ) {}

  async list(organizationId: string) {
    const cards = await this.prisma.creditCard.findMany({
      where: { organizationId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: { paymentAccount: { select: { id: true, name: true, institution: true } } },
    });

    const snapshot = await this.snapshots.load(organizationId);

    // Cada cartao ja sai da listagem com o ciclo corrente resolvido — a UI
    // precisa disso em todo card e nao deveria refazer a matematica de datas.
    return cards.map((card) => {
      const domain = toCreditCard(card);
      const currentMonth = toYearMonth(snapshot.today);
      const cycle = cycleForReferenceMonth(addMonthsToYearMonth(currentMonth, 1), domain);
      const progress = cycleProgress(cycle, snapshot.today);
      return { ...card, currentCycle: { ...cycle, ...progress } };
    });
  }

  create(organizationId: string, dto: CreateCreditCardDto) {
    return this.prisma.creditCard.create({
      data: { organizationId, color: '#16161A', ...dto },
    });
  }

  async update(organizationId: string, id: string, dto: UpdateCreditCardDto) {
    await this.prisma.creditCard.updateMany({ where: { id, organizationId }, data: { ...dto } });
    return this.prisma.creditCard.findFirstOrThrow({ where: { id, organizationId } });
  }

  async remove(organizationId: string, id: string) {
    await this.prisma.creditCard.deleteMany({ where: { id, organizationId } });
    return { id, deleted: true };
  }

  /** Serie de faturas do cartao — barras cheias (realizadas) e contornadas (projetadas). */
  async invoices(organizationId: string, cardId: string, from?: string, months = 10) {
    const snapshot = await this.snapshots.load(organizationId);
    const currentMonth = toYearMonth(snapshot.today);
    // Janela padrao centrada no presente: 4 meses de historico + o corrente + o futuro.
    const start = from ?? addMonthsToYearMonth(currentMonth, -4);

    return projectCardInvoices({
      ...snapshot,
      cardId,
      from: start,
      months,
    });
  }
}

@ApiTags('credit-cards')
@Controller('credit-cards')
export class CreditCardsController {
  constructor(private readonly service: CreditCardsService) {}

  @Get()
  @ApiOperation({ summary: 'Cartoes com o ciclo corrente ja resolvido.' })
  list(@Ctx() ctx: RequestContext) {
    return this.service.list(ctx.organizationId);
  }

  @Get(':id/invoices')
  @ApiOperation({ summary: 'Faturas do cartao, realizadas e projetadas.' })
  invoices(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Query() query: HorizonQueryDto,
  ) {
    return this.service.invoices(ctx.organizationId, id, query.from, query.months ?? 10);
  }

  @Post()
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateCreditCardDto) {
    return this.service.create(ctx.organizationId, dto);
  }

  @Patch(':id')
  update(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body() dto: UpdateCreditCardDto) {
    return this.service.update(ctx.organizationId, id, dto);
  }

  @Delete(':id')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.service.remove(ctx.organizationId, id);
  }
}

@Module({
  controllers: [CreditCardsController],
  providers: [CreditCardsService],
  exports: [CreditCardsService],
})
export class CreditCardsModule {}
