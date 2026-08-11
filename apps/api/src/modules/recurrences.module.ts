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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
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
import {
  FREQUENCIES,
  PAYMENT_METHODS,
  TRANSACTION_TYPES,
  nextOccurrence,
  today as todayIn,
} from '@finflow/shared';
import { Ctx, type RequestContext } from '../auth/auth.types';
import { ISO_DATE_REGEX } from '../common/dto';
import { toRecurringRule } from '../domain/snapshot.service';
import { PrismaService } from '../prisma/prisma.service';

export class CreateRecurrenceDto {
  @IsString() @MaxLength(160) description!: string;
  /** Valor em CENTAVOS. */
  @IsInt() @Min(1) amount!: number;
  @IsIn(TRANSACTION_TYPES) type!: string;
  @IsIn(FREQUENCIES) frequency!: string;
  @IsOptional() @IsInt() @Min(1) @Max(31) dayOfMonth?: number;
  @IsOptional() @IsInt() @Min(0) @Max(6) weekday?: number;
  @Matches(ISO_DATE_REGEX) startDate!: string;
  @IsOptional() @Matches(ISO_DATE_REGEX) endDate?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsString() creditCardId?: string;
  @IsOptional() @IsIn(PAYMENT_METHODS) paymentMethod?: string;
  @IsOptional() @IsString() @MaxLength(40) label?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateRecurrenceDto {
  @IsOptional() @IsString() @MaxLength(160) description?: string;
  @IsOptional() @IsInt() @Min(1) amount?: number;
  @IsOptional() @IsIn(TRANSACTION_TYPES) type?: string;
  @IsOptional() @IsIn(FREQUENCIES) frequency?: string;
  @IsOptional() @IsInt() @Min(1) @Max(31) dayOfMonth?: number;
  @IsOptional() @IsInt() @Min(0) @Max(6) weekday?: number;
  @IsOptional() @Matches(ISO_DATE_REGEX) startDate?: string;
  @IsOptional() @Matches(ISO_DATE_REGEX) endDate?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsString() creditCardId?: string;
  @IsOptional() @IsIn(PAYMENT_METHODS) paymentMethod?: string;
  @IsOptional() @IsString() @MaxLength(40) label?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Injectable()
export class RecurrencesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string) {
    const [rules, organization] = await Promise.all([
      this.prisma.recurringRule.findMany({
        where: { organizationId },
        orderBy: [{ isActive: 'desc' }, { type: 'asc' }, { amount: 'desc' }],
        include: {
          category: { select: { id: true, name: true, color: true } },
          account: { select: { id: true, name: true } },
          creditCard: { select: { id: true, name: true } },
        },
      }),
      this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    ]);

    const today = todayIn(organization.timezone);
    return rules.map((rule) => ({
      ...rule,
      nextOccurrence: nextOccurrence(toRecurringRule(rule), today),
    }));
  }

  create(organizationId: string, dto: CreateRecurrenceDto) {
    return this.prisma.recurringRule.create({ data: { organizationId, ...dto } });
  }

  async update(organizationId: string, id: string, dto: UpdateRecurrenceDto) {
    await this.prisma.recurringRule.updateMany({ where: { id, organizationId }, data: { ...dto } });
    return this.prisma.recurringRule.findFirstOrThrow({ where: { id, organizationId } });
  }

  async remove(organizationId: string, id: string) {
    await this.prisma.recurringRule.deleteMany({ where: { id, organizationId } });
    return { id, deleted: true };
  }
}

@ApiTags('recurrences')
@Controller('recurrences')
export class RecurrencesController {
  constructor(private readonly service: RecurrencesService) {}

  @Get()
  @ApiOperation({ summary: 'Recorrencias reconhecidas, com a proxima ocorrencia.' })
  list(@Ctx() ctx: RequestContext) {
    return this.service.list(ctx.organizationId);
  }

  @Post()
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateRecurrenceDto) {
    return this.service.create(ctx.organizationId, dto);
  }

  @Patch(':id')
  update(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body() dto: UpdateRecurrenceDto) {
    return this.service.update(ctx.organizationId, id, dto);
  }

  @Delete(':id')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.service.remove(ctx.organizationId, id);
  }
}

@Module({
  controllers: [RecurrencesController],
  providers: [RecurrencesService],
  exports: [RecurrencesService],
})
export class RecurrencesModule {}
