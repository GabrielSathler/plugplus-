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
  IsHexColor,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ACCOUNT_TYPES } from '@finflow/shared';
import { Ctx, type RequestContext } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

/* --------------------------------- DTOs ---------------------------------- */

export class CreateAccountDto {
  @IsString() @MaxLength(80) name!: string;
  @IsIn(ACCOUNT_TYPES) type!: string;
  @IsOptional() @IsString() @MaxLength(80) institution?: string;
  @IsOptional() @IsString() @MaxLength(20) accountNumber?: string;
  /** Saldo em CENTAVOS. */
  @IsOptional() @IsInt() openingBalance?: number;
  @IsOptional() @IsInt() currentBalance?: number;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsBoolean() includeInTotals?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateAccountDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsIn(ACCOUNT_TYPES) type?: string;
  @IsOptional() @IsString() @MaxLength(80) institution?: string;
  @IsOptional() @IsString() @MaxLength(20) accountNumber?: string;
  @IsOptional() @IsInt() currentBalance?: number;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsBoolean() includeInTotals?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

/* -------------------------------- Service -------------------------------- */

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  list(organizationId: string) {
    return this.prisma.account.findMany({
      where: { organizationId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  get(organizationId: string, id: string) {
    return this.prisma.account.findFirstOrThrow({ where: { id, organizationId } });
  }

  create(organizationId: string, dto: CreateAccountDto) {
    const opening = dto.openingBalance ?? dto.currentBalance ?? 0;
    return this.prisma.account.create({
      data: {
        organizationId,
        name: dto.name,
        type: dto.type,
        institution: dto.institution ?? null,
        accountNumber: dto.accountNumber ?? null,
        openingBalance: opening,
        currentBalance: dto.currentBalance ?? opening,
        color: dto.color ?? '#0F8A72',
        includeInTotals: dto.includeInTotals ?? true,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(organizationId: string, id: string, dto: UpdateAccountDto) {
    // `updateMany` + leitura garante que o filtro de tenant participe do WHERE;
    // um `update` por id sozinho permitiria escrever em conta de outra org.
    await this.prisma.account.updateMany({ where: { id, organizationId }, data: { ...dto } });
    return this.get(organizationId, id);
  }

  async remove(organizationId: string, id: string) {
    await this.prisma.account.deleteMany({ where: { id, organizationId } });
    return { id, deleted: true };
  }
}

/* ------------------------------- Controller ------------------------------ */

@ApiTags('accounts')
@Controller('accounts')
export class AccountsController {
  constructor(private readonly service: AccountsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista as contas da organizacao.' })
  list(@Ctx() ctx: RequestContext) {
    return this.service.list(ctx.organizationId);
  }

  @Get(':id')
  get(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.service.get(ctx.organizationId, id);
  }

  @Post()
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateAccountDto) {
    return this.service.create(ctx.organizationId, dto);
  }

  @Patch(':id')
  update(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body() dto: UpdateAccountDto) {
    return this.service.update(ctx.organizationId, id, dto);
  }

  @Delete(':id')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.service.remove(ctx.organizationId, id);
  }
}

@Module({
  controllers: [AccountsController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
