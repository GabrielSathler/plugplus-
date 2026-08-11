import { Body, Controller, Get, Injectable, Module, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Ctx, type RequestContext } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

export class UpdateSettingsDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(16) badge?: string;
  @IsOptional() @IsIn(['BRL', 'USD', 'EUR']) currency?: string;
  @IsOptional() @IsString() @MaxLength(10) locale?: string;
  @IsOptional() @IsString() @MaxLength(40) timezone?: string;

  /** Dia em que o mes financeiro comeca (1-28; acima disso quebraria fevereiro). */
  @IsOptional() @IsInt() @Min(1) @Max(28) fiscalMonthStartDay?: number;
  @IsOptional() @IsInt() @Min(1) @Max(36) projectionHorizon?: number;
  @IsOptional() @IsInt() @Min(0) @Max(24) autoSyncPerDay?: number;
  @IsOptional() @IsString() @MaxLength(40) exportPreference?: string;
  @IsOptional() @IsInt() @Min(1) @Max(200) commitmentTarget?: number;
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  get(organizationId: string) {
    return this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  }

  update(organizationId: string, dto: UpdateSettingsDto) {
    return this.prisma.organization.update({ where: { id: organizationId }, data: { ...dto } });
  }
}

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Preferencias da organizacao (tela Ajustes).' })
  get(@Ctx() ctx: RequestContext) {
    return this.service.get(ctx.organizationId);
  }

  @Patch()
  update(@Ctx() ctx: RequestContext, @Body() dto: UpdateSettingsDto) {
    return this.service.update(ctx.organizationId, dto);
  }
}

@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
