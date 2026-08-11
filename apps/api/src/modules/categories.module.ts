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
import { IsBoolean, IsHexColor, IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { CATEGORY_KINDS } from '@finflow/shared';
import { Ctx, type RequestContext } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

export class CreateCategoryDto {
  @IsString() @MaxLength(60) name!: string;
  @IsIn(CATEGORY_KINDS) kind!: string;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsString() @MaxLength(40) icon?: string;
  @IsOptional() @IsString() parentId?: string;
  @IsOptional() @IsBoolean() isFee?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class UpdateCategoryDto {
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @IsIn(CATEGORY_KINDS) kind?: string;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsString() @MaxLength(40) icon?: string;
  @IsOptional() @IsString() parentId?: string;
  @IsOptional() @IsBoolean() isFee?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  list(organizationId: string) {
    return this.prisma.category.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  create(organizationId: string, dto: CreateCategoryDto) {
    return this.prisma.category.create({ data: { organizationId, ...dto } });
  }

  async update(organizationId: string, id: string, dto: UpdateCategoryDto) {
    await this.prisma.category.updateMany({ where: { id, organizationId }, data: { ...dto } });
    return this.prisma.category.findFirstOrThrow({ where: { id, organizationId } });
  }

  async remove(organizationId: string, id: string) {
    // As transacoes ficam com `categoryId = null` (onDelete: SetNull no schema)
    // em vez de sumirem junto: perder historico por apagar uma categoria seria
    // destrutivo demais para ser o comportamento padrao.
    await this.prisma.category.deleteMany({ where: { id, organizationId } });
    return { id, deleted: true };
  }
}

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly service: CategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'Arvore de categorias da organizacao.' })
  list(@Ctx() ctx: RequestContext) {
    return this.service.list(ctx.organizationId);
  }

  @Post()
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateCategoryDto) {
    return this.service.create(ctx.organizationId, dto);
  }

  @Patch(':id')
  update(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.service.update(ctx.organizationId, id, dto);
  }

  @Delete(':id')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.service.remove(ctx.organizationId, id);
  }
}

@Module({
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
